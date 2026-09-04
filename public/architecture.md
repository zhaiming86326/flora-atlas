# 草木集 · 数据结构与全量接入设计

版本：2026-09-04 / prototype 1.0

## 当前已实现

- 12 种精简示例、9 科、12 属、3 个植物类群。
- 分类树、科和属筛选、中文名/学名/别名/异名搜索、用途交叉筛选、排序、分页、图鉴与列表切换。
- 可直接打开与刷新的 `#plant/<slug>` 详情链接；搜索与筛选状态存入 URL。
- 逐字段来源和版本，逐图作者、许可、来源链接。示例全部本地随站分发，核心功能不依赖第三方 API。
- `public/domain.js` 封装数据访问与查询；以新的 API Repository 替换 DemoPlantRepository 即可逐步迁移服务端。
- 没有数据库后台、登录管理页面或自动全量更新。Sites 的部署访问控制提供仅所有者访问。

## 为什么将名称、来源和用途分开

一个学名字符串不能作为跨数据源的唯一主键。相同学名在不同来源、不同版本中可能有不同接受状态；异名可能指向另一条接受名记录。中文名也可能一名多物。

使用站内稳定 `taxon_id` 表示经审核的展示记录；`source_records` 用 `(release_id, external_id)` 唯一定位某批次的来源记录。跨来源映射写入 `taxon_source_mappings`，明确匹配依据与审核时间。重新导入不能静默覆盖旧版本。

`parent_external_id` 和 `accepted_external_id` 保留原数据源标识；完整导入后再解析关系。WCVP 的接受名指向自身是合法来源语义。跨来源仅用同名不能认定物种相同；优先检查标识符、命名人、等级、接受关系，再进入人工审核。

用途独立存放在 `use_assertions`，保留用途分类、部位、参考文献、许可与审核状态。媒体独立存储，图片文件与文字数据分别授权。植物名称和分类名录本身不等于完整的用途数据库。

## 数据源及许可

- 名称与标识符：[Wikidata](https://www.wikidata.org/) 结构化数据；[CC0 许可说明](https://www.wikidata.org/wiki/Wikidata:Licensing)。示例逐条记录来源 URL。
- 中文摘要独立编写，采用 CC0 1.0；形态、园艺与用途事实参考 [NC State Extension Gardener Plant Toolbox](https://plants.ces.ncsu.edu/)，未复制其原文、未把参考站原文重新授权为 CC0。
- 摄影作者、原始 URL、CC BY / CC0 许可与改动说明见 `media.json` 与站内署名页。图片压缩、网页裁切。下载数据 JSON 不包含图片文件授权的转移。
- 中文别名为手工编辑示例，未声称是某地区官方命名；部分俗名可能跨物种共用。

## 批量导入

`scripts/import-taxonomy.py` 是本地转换器，读取**已解压且有表头**的 UTF-8 文件。它不会下载、调用网站后台或写外部数据库。

支持 WFO 的 Darwin Core 名称表和 WCVP 的名称表。WFO 的 ColDP zip 和 JSON 分发不是相同格式，不能直接交给此适配器；应先按对应格式转换。运行必须明确数据源、版本、下载 URL、许可标识和许可 URL，避免猜测授权。

```bash
python scripts/import-taxonomy.py names.txt --format wcvp --version 2026-06 \
  --source-url https://sftp.kew.org/pub/data-repositories/WCVP/wcvp.zip \
  --license CC-BY-4.0 --license-url https://creativecommons.org/licenses/by/4.0/ \
  --output staging/wcvp-2026-06.jsonl
```

示例版本仅演示参数，不承诺该快照的字段与许可可不经检查直接采用。应对照所下载版本的 README、元数据和许可。转换器检查必需列、重复 ID、缺失名称，保留全部原始行，输出 SHA-256、记录数、异常引用数与批次元数据。出现缺失关系时阻止直接入正式表，需要检查日志。

| 展示域 | WFO Darwin Core | WCVP 名称表 |
|---|---|---|
| 来源标识 | taxonID | plant_name_id |
| 学名 | scientificName | taxon_name |
| 命名人 | scientificNameAuthorship | taxon_authors |
| 等级 | taxonRank | taxon_rank |
| 状态 | taxonomicStatus | taxon_status |
| 接受名引用 | acceptedNameUsageID | accepted_plant_name_id |
| 父级引用 | parentNameUsageID | 若提供 parent_plant_name_id 则保留；否则为空 |
| 科 / 属 | family / genus | family / genus |
| IPNI | 仅明确 IPNI 字段时导入 | ipni_id |

WCVP 原始名称表不保证提供完整父级 ID；不能凭 genus 字符串伪造父记录。使用后续解析阶段查找真实来源记录，或引入对应 DwC 分类层级。保留未知状态和来源原文，不强行改成 accepted。

来源格式依据：[Darwin Core 术语](https://dwc.tdwg.org/list/)、[WFO 数据贡献约定](https://www.worldfloraonline.org/contribute)、[WCVP 名称表字段](https://matildabrown.github.io/rWCVPdata/reference/wcvp_names.html)。WFO 分发格式参见[发布样例](https://zenodo.org/records/15704590)；WCVP 发布入口见[官方目录](https://sftp.kew.org/pub/data-repositories/WCVP/)。

## 后续部署结构

建议保留当前静态前端，接入 PostgreSQL 及只读查询 API。图片使用对象存储与缩略图；不把全量照片或植物名录整体塞入浏览器。该方案尚未配置或购买外部服务。

`public/schema.sql` 提供 PostgreSQL 16+ 目标表结构。由暂存表完成名称映射与外键检查后，再事务化写正式表。来源批次带版本和校验和，失败可回滚，旧版本可追踪。

建议 API：

- `GET /api/plants?q=&group=&family=&genus=&use=&sort=&cursor=&limit=24`
- `GET /api/plants/:taxon_id`
- `GET /api/facets?group=&family=&q=`

响应统一为 `{items,total,nextCursor,facets,datasetVersion}`。分页和筛选在服务端执行；学名、中文名、别名、异名进入 `search_names`。精确匹配用 B-tree，模糊匹配可用 pg_trgm（以托管数据库实际支持为准）；中文全文分词可在后续单独评估。前端查询参数要校验，限制 limit，SQL 必须参数化。

图鉴页的分类组是浏览标签，不伪装为同一分类阶元。示例中的 `parentTaxonId` 使用编辑命名空间指向 genus，未来应从规范化 taxonomy 节点表生成全部父级记录；目前 UI 使用内嵌科属事实生成浏览树。
