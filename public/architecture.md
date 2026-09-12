# 草木集 · D1/R2 分层加载架构

版本：2026-09-08 / prototype 1.1

## 当前目标

页面分三层加载，避免一打开就从数据库拉取大量植物详情：

- 首屏“草木有名，万物可识”：只请求 `/api/summary`，拿到物种总数、科数量、固定 3 类，以及所有科的基础数据。
- 植物分页层：用户滚动到图鉴区域后才请求 `/api/plants`，每页只返回植物基础卡片信息。
- 详情层：点击某个植物后才请求 `/api/plants/:taxon_id`，返回完整文字、来源、图片等详情。

首屏拿到的所有科会缓存在浏览器内，用来填充“按科筛选”。筛选项显示为：

```text
中文科名（English family）
```

## D1 表设计

Cloudflare D1 数据库名：`flora-atlas`。

`taxa` 是物种分页主表，只放适合列表查询和详情定位的物种记录。`family_taxon_id` 和 `genus_taxon_id` 是上级分类单元 ID，但不设置强外键，因为现有数据中有些 ID 缺失或无法完全匹配，例如 `wfo-4000000988`。

`higher_taxa` 存放科、属等上级分类单元：

```text
taxa
  family_taxon_id  -> higher_taxa.taxon_id（尽量匹配，不强制）
  genus_taxon_id   -> higher_taxa.taxon_id（尽量匹配，不强制）

higher_taxa
  taxon_id
  taxon_rank
  scientific_name
  chinese_name
```

列表查询可以一次性左连接科属：

```sql
SELECT
  t.taxon_id,
  t.scientific_name,
  t.chinese_name,
  t.family_taxon_id,
  t.genus_taxon_id,
  family.scientific_name AS family_name,
  family.chinese_name AS family_chinese_name,
  genus.scientific_name AS genus_name,
  genus.chinese_name AS genus_chinese_name
FROM taxa t
LEFT JOIN higher_taxa family ON family.taxon_id = t.family_taxon_id
LEFT JOIN higher_taxa genus ON genus.taxon_id = t.genus_taxon_id
WHERE lower(coalesce(t.taxon_rank, 'species')) = 'species'
LIMIT ? OFFSET ?;
```

使用 `LEFT JOIN` 是有意的：上级分类缺失时，物种仍然能展示，只是科属名称回退为空或 ID。

## API

Worker 暴露四个读接口：

```text
GET /api/summary
GET /api/families
GET /api/plants?limit=24&offset=0&q=&group=&family=&sort=name
GET /api/plants/:taxon_id
```

`/api/summary` 返回：

```json
{
  "stats": {
    "species": 12345,
    "families": 456,
    "groups": 3
  },
  "groups": [
    {"id": "angiosperms", "name": "被子植物"},
    {"id": "gymnosperms", "name": "裸子植物"},
    {"id": "ferns", "name": "蕨类植物"}
  ],
  "families": [
    {
      "id": "wfo-7000000051",
      "name": "Rosaceae",
      "chineseName": "蔷薇科"
    }
  ]
}
```

`/api/plants` 只返回分页卡片需要的基础字段，不返回大段详情文本。这样滚动、搜索、翻页和按科筛选都不会扫出整库详情。

`/api/plants/:taxon_id` 才返回详情页字段，适合之后继续扩展描述、分布、用途、来源、许可等内容。

## R2 图片

图片已上传到 Cloudflare R2：

```text
https://pub-3517da5ed83f46628c557cd926a014a5.r2.dev/imgs
```

当前约定：图片文件名使用小写物种学名，空格替换为中划线。Worker 会按学名生成图片地址：

```text
Abelmoschus manihot -> /imgs/abelmoschus-manihot.webp
```

如果实际图片扩展名不是 `.webp`，可以通过 Worker 环境变量 `R2_IMAGE_EXTENSION` 调整。

## 静态 fallback

本地构建会把 `public/data.json` 拆成：

```text
public/summary.json
public/plant-list.json
public/plant-details/<slug>.json
```

当 Worker API 不可用时，前端自动回退到这些静态文件，仍然保持同样的三层加载模型。这个 fallback 只用于开发和演示，不替代正式 D1 数据。
