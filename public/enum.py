import json
# 建议在数据库/代码中设为枚举 (Enum)
PlantGrowthForm = {
    # 乔木（高大木本，有明显主干）
    "TREE": "TREE",
    # 灌木（矮小木本，无明显主干或多分枝）       
    "SHRUB": "SHRUB",
    # 亚灌木/小灌木（基部木质化，上部草质）   
    "SUB_SHRUB": "SUB_SHRUB", 
    "HERB": "HERB",           # 草本（无持久木质茎）
    "VINE": "VINE",           # 藤本/攀援植物（木质或草质缠绕攀援）
    "LIANA": "LIANA",         # 木质藤本（特指热带/亚热带高大木质藤本）
    "EPIPHYTE": "EPIPHYTE",   # 附生植物（附着于其他植物表面生长，如附生蕨类、兰花）
    "SUCCULENT": "SUCCULENT", # 多肉/肉质植物（茎或叶肥厚贮水）
    "AQUATIC": "AQUATIC"      # 水生植物（沉水/浮水/挺水）
}

# 描述草本植物的生命周期长短，通常单独设为一个枚举字段。
PlantLifeCycle = {
    "ANNUAL": "ANNUAL",       # 一年生（一年内完成发芽到结实全过程）
    "BIENNIAL": "BIENNIAL",   # 二年生（跨越两个生长季）
    "PERENNIAL": "PERENNIAL"  # 多年生（寿命在两年以上，木本植物均为多年生）
}

# 叶型/落叶习性（Deciduous Status）：
DeciduousStatus = {
    "EVERGREEN": "EVERGREEN",     # 常绿
    "DECIDUOUS": "DECIDUOUS",     # 落叶
    "SEMI_EVERGREEN": "SEMI_EVERGREEN"  # 半常绿
}

# 水份适应性（Moisture Habit）：
MoistureHabit = {
    "XEROPHYTE": "XEROPHYTE",     # 旱生
    "MESOPHYTE": "MESOPHYTE",     # 中生，大多数陆生植物
    "HYGROPHYTE": "HYGROPHYTE",   # 湿生
    "HYDROPHYTE": "HYDROPHYTE"    # 水生
}

# 植物功能/用途枚举定义
PlantFunction = {
    "EDIBLE": "EDIBLE",             # 食用（粮食、蔬菜、水果、坚果、油料、调味料等）
    "MEDICINAL": "MEDICINAL",       # 药用（中药材、提取物原料、民族药）
    "ORNAMENTAL": "ORNAMENTAL",     # 观赏/园艺（花卉、盆景、切花、行道树、造景）
    "ECOLOGICAL": "ECOLOGICAL",     # 生态水土保持（固沙、水土保持、抗风防浪、绿化防护）
    "INDUSTRIAL": "INDUSTRIAL",     # 工业/加工原料（纤维、木材、橡胶、树脂、鞣料、染料）
    "ENVIRONMENTAL": "ENVIRONMENTAL", # 环境改善（空气净化、降噪、重金属吸附/植物修复）
    "NECTAR_POLLEN": "NECTAR_POLLEN", # 蜜源植物（养蜂、生态授粉）
    "TOXIC_HAZARD": "TOXIC_HAZARD"  # 毒性/警示植物（具有杀虫/毒性，需谨慎接触或用于生物农药）
}