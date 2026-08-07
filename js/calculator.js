/**
 * 爆炸复合板成本核算引擎
 * 基于爆炸毛利表-成本0804.xlsx的公式逻辑
 */

// ========== 材料数据库 ==========

// 复层材料密度 (g/cm³) - 支持自动查询
const CLADDING_DENSITY = {
  // 不锈钢 (标准牌号)
  'S31603': 8.0, 'S31608': 8.0, 'S30403': 8.0, 'S30408': 8.0,
  'S31008': 8.0, 'S39042': 8.0, 'S31703': 8.0,
  'S32101': 7.8, 'S32205': 7.8, 'S32750': 7.8,
  // 不锈钢 (常用别名)
  '304': 8.0, '304L': 8.0, '316': 8.0, '316L': 8.0,
  '321': 8.0, '310S': 8.0, '309S': 8.0, '316TI': 8.0,
  '2205': 7.8, '2507': 7.8, '2304': 7.8,
  // 钛及钛合金
  'TA1': 4.51, 'TA2': 4.51, 'TA9': 4.51, 'TA10': 4.51,
  'TA3': 4.51, 'TA4': 4.51, 'TC4': 4.43,
  // 镍基合金
  'N06625': 8.44, 'N08825': 8.14, 'N06600': 8.47,
  'N10276': 8.89, 'N06601': 8.11, 'N04400': 8.83,
  // 铜合金
  'TU1': 8.9, 'T2': 8.9, 'H62': 8.43, 'B10': 8.9, 'B30': 8.9,
  'T3': 8.89, 'H68': 8.5, 'HSn70-1': 8.54, 'QAl9-2': 7.6,
  // 锆及锆合金
  'R60702': 6.51, 'R60705': 6.51, 'Zr': 6.51,
  // 钽
  'Ta': 16.6, 'Ta1': 16.6, 'Ta2': 16.6,
  // 铝
  'L1': 2.71, 'L2': 2.71, '1060': 2.70, '5052': 2.68, '6061': 2.70,
};

// 基层材料密度
const BASE_DENSITY = {
  'Q235B': 7.85, 'Q235C': 7.85, 'Q345R': 7.85, 'Q245R': 7.85,
  'Q345B': 7.85, 'Q355B': 7.85, 'Q370R': 7.85,
  'Q345q': 7.85, 'Q370q': 7.85, 'Q420q': 7.85,
  '20R': 7.85, '16MnR': 7.85, '16Mn': 7.85, '20g': 7.85,
  'Q345': 7.85, 'Q355': 7.85, 'Q235': 7.85,
  'A516Gr70': 7.85, 'SA516Gr70': 7.85, 'A36': 7.85,
  '09MnNiDR': 7.85, '15CrMoR': 7.85, '12Cr1MoVR': 7.85,
};

// 材料类型分类 (用于爆炸单价查表)
const MATERIAL_CATEGORY = {
  // 奥氏体不锈钢
  'S31603': 'austenitic', 'S31608': 'austenitic', 'S30403': 'austenitic',
  'S30408': 'austenitic', 'S31008': 'austenitic', 'S31703': 'austenitic',
  'S39042': 'austenitic',
  // 奥氏体不锈钢 (常用别名)
  '304': 'austenitic', '304L': 'austenitic', '316': 'austenitic',
  '316L': 'austenitic', '321': 'austenitic', '310S': 'austenitic',
  '309S': 'austenitic', '316TI': 'austenitic',
  // 双相不锈钢
  'S32205': 'duplex', 'S32750': 'duplex', 'S32101': 'duplex',
  '2205': 'duplex', '2507': 'duplex', '2304': 'duplex',
  // 钛及钛合金
  'TA1': 'titanium', 'TA2': 'titanium', 'TA9': 'titanium', 'TA10': 'titanium',
  // 镍基合金 & 铜合金
  'N06625': 'nickel', 'N08825': 'nickel', 'N06600': 'nickel',
  'TU1': 'nickel', 'T2': 'nickel', 'H62': 'nickel', 'B10': 'nickel', 'B30': 'nickel',
};

// 爆炸单价表 (元/㎡) - 基于复层厚度和材料类型
const EXPLOSION_PRICE_TABLE = {
  // 复层厚度: { 奥氏体不锈钢, 双相不锈钢, 钛及钛合金, 镍基合金&铜合金 }
  2:  { austenitic: 211, duplex: 240, titanium: 225, nickel: 225 },
  3:  { austenitic: 241, duplex: 270, titanium: 250, nickel: 256 },
  4:  { austenitic: 285, duplex: 300, titanium: 300, nickel: 285 },
  5:  { austenitic: 340, duplex: 360, titanium: 340, nickel: 340 },
  6:  { austenitic: 380, duplex: 415, titanium: 390, nickel: 400 },
  8:  { austenitic: 400, duplex: 450, titanium: 475, nickel: 435 },
  10: { austenitic: 490, duplex: 515, titanium: 565, nickel: 480 },
  12: { austenitic: 545, duplex: 590, titanium: 725, nickel: 540 },
};

// 加工费用标准 (元/㎡ 或 元/吨 或 元/m)
const PROCESSING_FEES = {
  // [单价, 单位]
  welding:     { name: '拼焊', price: 8,     unit: 'm'  },     // 拼焊
  grindingClad:  { name: '打磨-复板', price: 6,  unit: '㎡' },  // 打磨覆层
  grindingBase:  { name: '打磨-基板', price: 16, unit: '㎡' },  // 打磨基层
  grindingFinish:{ name: '打磨-成品', price: 24, unit: '㎡' },  // 打磨成品
  transport:   { name: '运输', price: 170,   unit: '吨' },     // 倒转运输
  heatTreat:   { name: '热处理', price: 0,   unit: '吨' },     // 热处理 (Excel毛利表默认0)
  straighten:  { name: '校平', price: 7,     unit: '吨' },     // 校平(实际按吨计)
  ut:          { name: 'UT',   price: 2,     unit: '㎡' },     // 超声波检测 (Excel毛利表=2)
  packaging:   { name: '包装', price: 5,     unit: '㎡' },     // 包装
  cutting:     { name: '切割', price: 2.5,   unit: 'm'  },     // 切割
  edgeMilling: { name: '铣边', price: 0,     unit: 'm'  },     // 铣边 (Excel毛利表默认0, 按需启用)
  pt:          { name: 'PT',   price: 12,    unit: 'm'  },     // 渗透检测
  repairWeld:  { name: '补焊', price: 45,    unit: '吨' },     // 补焊(Excel毛利表=45)
};

// 固定费用 (元/吨)
const FIXED_COSTS = {
  labor: 970,       // 人工
  depreciation: 700, // 折旧
  electricity: 338,  // 电费
};

// ========== 默认参数 ==========

const DEFAULTS = {
  explosionPrice: 280,     // 爆炸单价 元/㎡ (默认值, 会被查表覆盖)
  processingCostPerTon: 1000, // 前后道吨钢加工成本 AJ
  passRate: 0.95,          // 合格率 AN
  taxRate: 1.13,           // 增值税率
  transportTaxRate: 1.09,  // 运输税率
  scrapSteelPrice: 2300,   // 废钢价格 元/吨
};

// 根据材料类型获取默认余量 (兼容旧接口, 内部调用 getMarginsByStandard)
function getDefaultMargins(grade) {
  const m = getMarginsByStandard(grade, 3, 10, 1600, 6000, {});
  return {
    baseWidening: m.baseWidening,
    baseLengthening: m.baseLengthening,
    claddingExtraMargin: m.claddingWidening, // 旧字段, 现在等于独立覆层余量
  };
}

// ========== 密度查询 ==========

/**
 * 查询材料密度（从本地数据库）
 * @param {string} material - 材料牌号
 * @param {string} type - 'cladding' | 'base'
 * @returns {number|null} 密度值 g/cm³, null=未找到
 */
function lookupDensity(material, type) {
  if (!material) return null;
  const mat = material.trim().toUpperCase();
  const db = type === 'cladding' ? CLADDING_DENSITY : BASE_DENSITY;
  if (db[mat] !== undefined) return db[mat];
  // 尝试去掉前后缀再查
  // 不锈钢统一以S开头查
  if (type === 'cladding' && mat.startsWith('S') && db[mat] === undefined) {
    // 尝试数字部分
    const num = mat.replace(/^S/i, '');
    if (db[num] !== undefined) return db[num];
  }
  return null;
}

/**
 * 生成在线搜索密度的URL
 * @param {string} material - 材料牌号
 * @returns {string} 搜索URL
 */
function getDensitySearchUrl(material) {
  return `https://www.baidu.com/s?wd=${encodeURIComponent(material + ' 材料密度 g/cm3')}`;
}

// ========== 材料价格参考 ==========

/**
 * 钢材价格参考数据（仅供参考，实际以市场价为准）
 * 数据来源：我的钢铁网、钢宝网等公开报价
 */
const STEEL_PRICE_REFERENCE = {
  // 碳钢/基层材料
  carbon: {
    'Q235B': { min: 3300, max: 3700, unit: '元/吨', desc: 'Q235碳钢中厚板' },
    'Q345R': { min: 3500, max: 3900, unit: '元/吨', desc: 'Q345R容器板' },
    'Q245R': { min: 3400, max: 3800, unit: '元/吨', desc: 'Q245R容器板' },
    'Q345B': { min: 3400, max: 3800, unit: '元/吨', desc: 'Q345低合金板' },
    'Q355B': { min: 3400, max: 3800, unit: '元/吨', desc: 'Q355低合金板' },
  },
  // 不锈钢/复层材料
  stainless: {
    'S30408': { min: 13000, max: 14000, unit: '元/吨', desc: '304不锈钢热轧卷板' },
    'S30403': { min: 13200, max: 14200, unit: '元/吨', desc: '304L不锈钢' },
    'S31608': { min: 22500, max: 24500, unit: '元/吨', desc: '316不锈钢' },
    'S31603': { min: 22800, max: 24800, unit: '元/吨', desc: '316L不锈钢' },
    'S31008': { min: 28000, max: 32000, unit: '元/吨', desc: '310S耐热不锈钢' },
    'S32205': { min: 28000, max: 32000, unit: '元/吨', desc: '2205双相不锈钢' },
    'S32750': { min: 45000, max: 55000, unit: '元/吨', desc: '2507超级双相不锈钢' },
  },
  // 钛材
  titanium: {
    'TA1': { min: 80000, max: 120000, unit: '元/吨', desc: 'TA1工业纯钛' },
    'TA2': { min: 80000, max: 120000, unit: '元/吨', desc: 'TA2工业纯钛' },
  },
  // 镍基合金
  nickel: {
    'N06625': { min: 180000, max: 250000, unit: '元/吨', desc: 'Inconel 625' },
    'N08825': { min: 150000, max: 200000, unit: '元/吨', desc: 'Incoloy 825' },
  },
};

/**
 * 获取材料价格参考
 * @param {string} material - 材料牌号
 * @param {string} category - 'carbon' | 'stainless' | 'titanium' | 'nickel'
 * @returns {Object|null} { min, max, unit, desc }
 */
function lookupPriceReference(material, category) {
  if (!material) return null;
  const mat = material.trim().toUpperCase();
  const db = STEEL_PRICE_REFERENCE[category];
  if (!db) return null;
  if (db[mat]) return db[mat];
  // 尝试去掉S前缀
  if (mat.startsWith('S') && mat.length > 1) {
    const num = mat.replace(/^S/i, '');
    if (db[num]) return db[num];
  }
  return null;
}

/**
 * 生成在线搜索钢材价格的URL
 * @param {string} material - 材料牌号
 * @returns {string} 搜索URL
 */
function getPriceSearchUrl(material) {
  return `https://www.baidu.com/s?wd=${encodeURIComponent(material + ' 钢材价格 今日报价 元/吨')}`;
}

// ========== 建议售价计算 ==========

/**
 * 根据成本计算建议售价
 * @param {Object} costData - calculateProcessCost返回的cost对象
 * @param {number} targetMarginRate - 目标利润率 (如0.15=15%)
 * @returns {Object} { suggestedPricePerTon, suggestedTotalAmount, costPerTon, marginPerTon, details }
 */
function calculateSuggestedPrice(costData, targetMarginRate = 0.15) {
  // BT: 加工成本含固定费用/吨
  const BT = costData.cost.BT;
  // BP: 吨成本不含固定费用
  const BP = costData.cost.BP;
  // R: 成品总重(吨)
  const R = costData.finished.R_total;

  if (R <= 0 || BT <= 0) {
    return { suggestedPricePerTon: 0, suggestedTotalAmount: 0, costPerTon: 0, marginPerTon: 0 };
  }

  // 建议含税单价 = BT * 1.13 * (1 + 目标利润率)
  // BU(毛利不含固定) = S/1.13 - BP
  // BV(毛利含固定) = BU - BQ - BR - BS = BU - (BT - BN) 
  // 要使BV = BT * 目标利润率:
  // S/1.13 - BP - (BT - BN) = BT * 目标利润率
  // S/1.13 = BP + BT - BN + BT * 目标利润率
  // S/1.13 = BP + BN + BQ+BR+BS - BN + BT * 目标利润率  (因为 BT = BN + BQ+BR+BS)
  // S/1.13 = BP + BQ+BR+BS + BT * 目标利润率
  // S/1.13 = BP + (BT - BN) + BT * 目标利润率
  
  // 简化：建议含税单价 = (BT + BT * 目标利润率) * 1.13
  // 这样 BV = S/1.13 - BP - (BT-BN) = BT*(1+rate) - BP - BT + BN = BT*rate - BP + BN
  // 不太对...让我重新推导

  // 目标：BV(含固定毛利/吨) = BT * targetMarginRate
  // BV = BU - BQ - BR - BS = S/1.13 - BP - (BT - BN)
  // BT * rate = S/1.13 - BP - BT + BN
  // S/1.13 = BT * rate + BP + BT - BN
  // S/1.13 = BT * (1 + rate) + BP - BN
  // 注意 BP = BK/R + BN, 所以 BP - BN = BK/R (原材料成本/吨)
  // S/1.13 = BT * (1 + rate) + BK/R
  // S = (BT * (1 + rate) + BK/R) * 1.13

  const BK_per_ton = R > 0 ? costData.cost.BK / R : 0;
  const BN = costData.cost.BN;
  const priceExclTax = BT * (1 + targetMarginRate) + BK_per_ton;
  const suggestedPricePerTon = Math.round(priceExclTax * 1.13);
  const suggestedTotalAmount = Math.round(suggestedPricePerTon * R * 100) / 100;

  // 计算对应的毛利
  const BU = suggestedPricePerTon / 1.13 - BP;
  const BV = BU - (BT - BN);
  const marginPerTon = BV;
  const marginTotal = BV * R;

  return {
    suggestedPricePerTon,
    suggestedTotalAmount,
    costPerTon: Math.round(BT + BK_per_ton),
    marginPerTon: Math.round(marginPerTon),
    marginTotal: Math.round(marginTotal),
    targetMarginRate,
    details: {
      BT: BT.toFixed(0),
      BK_per_ton: BK_per_ton.toFixed(0),
      BN: BN.toFixed(0),
      BP: BP.toFixed(0),
      priceExclTax: priceExclTax.toFixed(0),
    },
  };
}

// ========== NB/T 47002.1-2019 放量标准 ==========

// 不锈钢常见可采购宽度 (mm)
const STANDARD_STAINLESS_WIDTHS = [1219, 1500, 1800, 2000, 2500];
const MAX_PURCHASE_LENGTH = 8000; // 最长采购长度

/**
 * 根据 NB/T 47002.1-2019 标准查表获取放量
 * @param {string} grade - 牌号, 如 "S31603+Q235B"
 * @param {number} claddingThickness - 复层厚度 mm
 * @param {number} baseThickness - 基层厚度 mm
 * @param {number} width - 成品宽度 mm
 * @param {number} length - 成品长度 mm
 * @param {Object} options - { sampling: bool, asmeSA264: bool }
 * @returns {Object} 余量参数
 */
function getMarginsByStandard(grade, claddingThickness, baseThickness, width, length, options = {}) {
  const claddingMat = getCladdingMaterial(grade);
  const category = MATERIAL_CATEGORY[claddingMat] || 'austenitic';

  // 钛材使用独立余量标准 (NB/T 47002.3)
  if (category === 'titanium') {
    let baseW = 60, baseL = 100, cladW = 40, cladL = 40;
    let notes = ['钛材标准余量'];
    if (options.sampling) {
      baseL += 120; cladL += 120;
      notes.push('取样+120mm');
    }
    return {
      baseWidening: baseW,
      baseLengthening: baseL,
      claddingWidening: cladW,
      claddingLengthening: cladL,
      asmeExtra: 0,
      marginSource: '钛材标准余量',
      conditionDesc: notes.join(' '),
      thicknessTolerance: '钛材标准',
      group: 0,
    };
  }

  // 不锈钢/双相钢: 新放量规则（按基层/复层厚度分组）
  // 基层放量: 基层<60 → +30(正常)/+40(重点订单); 基层>=60 → +60
  // 复层放量 = 基层放量 + 60
  const isThick = baseThickness >= 60;
  const isKeyOrder = options.keyOrder || false;

  let baseWidening, claddingWidening;
  let groupDesc, conditionDesc;

  if (isThick) {
    // 厚板: 基层>=60mm
    baseWidening = 60;
    claddingWidening = baseWidening + 60;  // 120
    groupDesc = '厚板(基层≥60mm)';
    conditionDesc = `基层≥60: 基层+${baseWidening}，复层=${baseWidening}+60=${claddingWidening}`;
  } else {
    // 薄板: 基层<60mm
    baseWidening = isKeyOrder ? 40 : 30;
    claddingWidening = baseWidening + 60;  // 90 或 100
    groupDesc = isKeyOrder ? '薄板-重点订单(基层<60mm)' : '薄板(基层<60mm)';
    conditionDesc = `基层<60: 基层+${baseWidening}，复层=${baseWidening}+60=${claddingWidening}`;
  }

  // 宽度和长度放量相同
  let baseLengthening = baseWidening;
  let claddingLengthening = claddingWidening;
  let notes = [conditionDesc];

  // 取样: 额外+120mm
  if (options.sampling) {
    baseLengthening += 120;
    claddingLengthening += 120;
    notes.push('取样+120mm');
  }

  // ASME SA264: 基层加厚1mm且要求正公差
  const asmeExtra = options.asmeSA264 ? 1 : 0;
  if (asmeExtra) {
    notes.push('ASME SA264: 基层+1mm');
  }

  return {
    baseWidening,
    baseLengthening,
    claddingWidening,
    claddingLengthening,
    asmeExtra,
    marginSource: groupDesc,
    conditionDesc: notes.join('，'),
    thicknessTolerance: isThick ? '厚板标准' : '薄板标准',
    group: isThick ? 3 : (isKeyOrder ? 2 : 1),
  };
}

/**
 * 检查采购尺寸是否符合可采购标准
 * @returns {Array} 警告信息数组
 */
function checkPurchaseSize(purchaseWidth, purchaseLength, isStainlessCladding) {
  const warnings = [];

  if (isStainlessCladding) {
    const matched = STANDARD_STAINLESS_WIDTHS.includes(purchaseWidth);
    if (!matched) {
      const nextUp = STANDARD_STAINLESS_WIDTHS.find(w => w >= purchaseWidth);
      if (nextUp) {
        warnings.push(`复层采购宽度 ${purchaseWidth}mm 非标准宽度，建议选用 ${nextUp}mm 标准板（余料≥${nextUp - purchaseWidth}mm）`);
      } else {
        warnings.push(`复层采购宽度 ${purchaseWidth}mm 超出最大标准宽度 2500mm，需拼焊设计`);
      }
    }
  }

  if (purchaseLength > MAX_PURCHASE_LENGTH) {
    warnings.push(`采购长度 ${purchaseLength}mm 超过最大长度 ${MAX_PURCHASE_LENGTH}mm，需倍尺或拼焊设计`);
  }

  return warnings;
}

// ========== 工具函数 ==========

function getCladdingMaterial(grade) {
  // 解析牌号, 如 "S31603+Q235B" => "S31603"
  if (!grade) return '';
  const parts = grade.split('+');
  return parts[0]?.trim() || '';
}

function getBaseMaterial(grade) {
  // 解析牌号, 如 "S31603+Q235B" => "Q235B"
  if (!grade) return '';
  const parts = grade.split('+');
  return parts[1]?.trim() || '';
}

function getCladdingDensity(grade) {
  const mat = getCladdingMaterial(grade);
  return CLADDING_DENSITY[mat] || 8.0; // 默认不锈钢密度
}

function getBaseDensity(grade) {
  const mat = getBaseMaterial(grade);
  return BASE_DENSITY[mat] || 7.85;
}

function getExplosionPrice(claddingThickness, grade) {
  const mat = getCladdingMaterial(grade);
  const category = MATERIAL_CATEGORY[mat] || 'austenitic';

  // 查表: 找到最接近的复层厚度
  const thicknesses = Object.keys(EXPLOSION_PRICE_TABLE).map(Number).sort((a, b) => a - b);

  // 精确匹配
  if (EXPLOSION_PRICE_TABLE[claddingThickness]) {
    return EXPLOSION_PRICE_TABLE[claddingThickness][category];
  }

  // 插值: 找到上下界
  let lower = null, upper = null;
  for (const t of thicknesses) {
    if (t <= claddingThickness) lower = t;
    if (t >= claddingThickness && !upper) upper = t;
  }

  if (lower && upper && lower !== upper) {
    // 线性插值
    const ratio = (claddingThickness - lower) / (upper - lower);
    const lowerPrice = EXPLOSION_PRICE_TABLE[lower][category];
    const upperPrice = EXPLOSION_PRICE_TABLE[upper][category];
    return Math.round(lowerPrice + ratio * (upperPrice - lowerPrice));
  }

  if (lower) return EXPLOSION_PRICE_TABLE[lower][category];
  if (upper) return EXPLOSION_PRICE_TABLE[upper][category];

  return DEFAULTS.explosionPrice;
}

// ========== 原材料尺寸设计 ==========

/**
 * 根据爆炸成品尺寸设计原材料(采购)尺寸
 * 不需要价格参数, 仅计算尺寸/面积/重量
 * @param {Object} input - 成品参数
 * @returns {Object} 原材料尺寸设计结果
 */
function designRawMaterial(input) {
  // 使用 NB/T 47002.1-2019 标准查表获取余量
  const stdMargins = getMarginsByStandard(
    input.grade || '', input.claddingThickness || 0, input.baseThickness || 0,
    input.width || 0, input.length || 0, input.options || {}
  );

  const {
    grade = '',
    claddingThickness: D = 0,
    baseThickness: F = 0,
    width: H = 0,
    length: I = 0,
    sheets: S = 1,
    isCircular = false,
  } = input;

  // 余量参数 (支持用户覆盖)
  const baseWidening = input.baseWidening ?? stdMargins.baseWidening;
  const baseLengthening = input.baseLengthening ?? stdMargins.baseLengthening;
  const claddingWidening = input.claddingWidening ?? stdMargins.claddingWidening;
  const claddingLengthening = input.claddingLengthening ?? stdMargins.claddingLengthening;
  const asmeExtra = stdMargins.asmeExtra;

  // 采购厚度 (ASME SA264 时基层+1mm)
  const E = D;                          // 采购复层厚度 = 成品复层厚度
  const G = F + asmeExtra;              // 采购基层厚度 (ASME时+1mm)

  // 密度 (支持手动覆盖)
  const R = input.claddingDensityOverride ?? getCladdingDensity(grade);
  const baseDensity = input.baseDensityOverride ?? getBaseDensity(grade);
  const category = MATERIAL_CATEGORY[getCladdingMaterial(grade)] || 'austenitic';

  // 圆形板面积计算 (mm²)
  const circleArea = (d) => Math.PI * (d / 2) * (d / 2);
  const finishedArea_mm2 = isCircular ? circleArea(H) : H * I;

  // ========== 余量与采购尺寸 ==========
  const C = D + F;                    // 成品总厚度 mm
  const K = H + baseWidening;         // 基层采购宽度 mm
  const O = I + baseLengthening;      // 基层采购长度 mm
  const M = H + claddingWidening;     // 复层采购宽度 mm
  const Q = I + claddingLengthening;  // 复层采购长度 mm

  // ========== 面积 ==========
  // 爆炸面积使用复层采购尺寸(复层是爆炸面), 非基层尺寸
  const explosionArea_mm2 = M * Q;                    // 爆炸面积(复层采购矩形) mm²
  const explosionAreaPerSheet = explosionArea_mm2 / 1000000; // ㎡
  const finishedAreaPerSheet = finishedArea_mm2 / 1000000;   // ㎡ (圆形用πr²)
  const totalFinishedArea = finishedAreaPerSheet * S;

  // ========== 重量 (采购尺寸始终按矩形) ==========
  const purchaseBaseWeight = Math.round(baseDensity * G * K * O / 1000000000 * 1000) / 1000;
  const purchaseCladdingWeight = Math.round(E * M * Q * R / 1000000000 * 1000) / 1000;
  const purchaseTotalWeight = purchaseBaseWeight + purchaseCladdingWeight;

  const finishedBaseWeight = Math.round(baseDensity * F * finishedArea_mm2 / 1000000000 * 1000) / 1000;
  const finishedCladdingWeight = Math.round(D * finishedArea_mm2 * R / 1000000000 * 1000) / 1000;
  const finishedUnitWeight = finishedBaseWeight + finishedCladdingWeight;
  const finishedTotalWeight = finishedUnitWeight * S;

  // ========== 成材率 ==========
  const baseYield = purchaseBaseWeight > 0 ? finishedBaseWeight / purchaseBaseWeight : 0;
  const claddingYield = purchaseCladdingWeight > 0 ? finishedCladdingWeight / purchaseCladdingWeight : 0;
  const totalYield = purchaseTotalWeight > 0 ? finishedUnitWeight / purchaseTotalWeight : 0;

  // ========== 尺寸合规检查 ==========
  const isStainless = category !== 'titanium';
  const warnings = checkPurchaseSize(M, Q, isStainless);

  return {
    input: {
      grade,
      claddingMaterial: getCladdingMaterial(grade),
      baseMaterial: getBaseMaterial(grade),
      claddingThickness: D,
      baseThickness: F,
      totalThickness: C,
      width: H,
      length: I,
      diameter: isCircular ? H : null,
      sheets: S,
      isCircular,
      purchaseCladdingThickness: E,
      purchaseBaseThickness: G,
    },
    margins: {
      baseWidening,
      baseLengthening,
      claddingWidening,
      claddingLengthening,
      asmeExtra,
      marginSource: stdMargins.marginSource,
      conditionDesc: stdMargins.conditionDesc,
      thicknessTolerance: stdMargins.thicknessTolerance,
      group: stdMargins.group,
    },
    rawMaterial: {
      basePurchaseWidth: K,
      basePurchaseLength: O,
      basePurchaseThickness: G,
      claddingPurchaseWidth: M,
      claddingPurchaseLength: Q,
      claddingPurchaseThickness: E,
    },
    area: {
      explosionAreaPerSheet,
      finishedAreaPerSheet,
      totalFinishedArea,
    },
    weight: {
      purchaseBaseWeight,
      purchaseCladdingWeight,
      purchaseTotalWeight,
      finishedBaseWeight,
      finishedCladdingWeight,
      finishedUnitWeight,
      finishedTotalWeight,
    },
    yield: {
      baseYield,
      claddingYield,
      totalYield,
    },
    material: {
      claddingDensity: R,
      baseDensity: baseDensity,
      category: category,
    },
    warnings,
  };
}

// ========== 核心成本计算 ==========

/**
 * 计算爆炸复合板成本
 * @param {Object} input - 输入参数
 * @param {string} input.grade - 牌号, 如 "S31603+Q235B"
 * @param {number} input.claddingThickness - 复层厚度 mm (D)
 * @param {number} input.baseThickness - 基层厚度 mm (F)
 * @param {number} input.width - 宽度 mm (H)
 * @param {number} input.length - 长度 mm (I)
 * @param {number} input.sheets - 张数 (S)
 * @param {number} [input.purchaseCladdingThickness] - 采购复层厚度 mm (E), 默认=D
 * @param {number} [input.purchaseBaseThickness] - 采购基层厚度 mm (G), 默认=F
 * @param {number} [input.baseWidening] - 基层加宽 mm (J), 默认=40
 * @param {number} [input.baseLengthening] - 基层加长 mm (N), 默认=50
 * @param {number} [input.carbonSteelPrice] - 碳钢单价 元/吨 (AE)
 * @param {number} [input.stainlessSteelPrice] - 不锈钢单价 元/吨 (AF)
 * @param {number} [input.quotationPerTon] - 吨钢报价 元/吨 (AP)
 * @param {number} [input.explosionPrice] - 爆炸单价 元/㎡ (AD), 默认查表
 * @returns {Object} 计算结果
 */
function calculateCost(input) {
  // 使用 NB/T 47002.1-2019 标准查表获取余量
  const stdMargins = getMarginsByStandard(
    input.grade || '', input.claddingThickness || 0, input.baseThickness || 0,
    input.width || 0, input.length || 0, input.options || {}
  );

  const {
    grade = '',
    claddingThickness: D = 0,
    baseThickness: F = 0,
    width: H = 0,
    length: I = 0,
    sheets: S = 1,
    carbonSteelPrice: AE = 0,
    stainlessSteelPrice: AF = 0,
    quotationPerTon: AP = 0,
    explosionPrice: AD,
    isCircular = false,
  } = input;

  // 余量参数 (支持用户覆盖)
  const baseWidening = input.baseWidening ?? stdMargins.baseWidening;
  const baseLengthening = input.baseLengthening ?? stdMargins.baseLengthening;
  const claddingWidening = input.claddingWidening ?? stdMargins.claddingWidening;
  const claddingLengthening = input.claddingLengthening ?? stdMargins.claddingLengthening;
  const asmeExtra = stdMargins.asmeExtra;

  // 采购厚度
  const E = D;                          // 采购复层厚度
  const G = F + asmeExtra;              // 采购基层厚度 (ASME时+1mm)

  // 密度
  const R = getCladdingDensity(grade);
  const baseDensity = getBaseDensity(grade);

  // 爆炸单价 (查表)
  const explosionPrice = AD || getExplosionPrice(D, grade);

  // 圆形板面积计算 (mm²)
  const circleArea = (d) => Math.PI * (d / 2) * (d / 2);
  const finishedArea_mm2 = isCircular ? circleArea(H) : H * I;

  // ========== 尺寸计算 ==========
  const C = D + F;                    // 总厚度 mm
  const K = H + baseWidening;         // 基层采购宽度 mm
  const M = H + claddingWidening;     // 复层采购宽度 mm
  const O = I + baseLengthening;      // 基层采购长度 mm
  const Q = I + claddingLengthening;  // 复层采购长度 mm

  // ========== 面积计算 ==========
  // 爆炸面积使用复层采购尺寸(复层是爆炸面), 非基层尺寸
  const T = M * Q / 1000000;          // 单板爆炸面积 ㎡ (复层采购尺寸, 始终矩形)
  const U = finishedArea_mm2 / 1000000; // 单板成品面积 ㎡ (圆形板用π*r²)
  const V = U * S;                     // 成品总面积 ㎡

  // ========== 重量计算 ==========
  // W: 采购基层单重 (吨) = 7.85 * G * K * O / 1e9 (采购尺寸, 始终矩形)
  const W = Math.round(baseDensity * G * K * O / 1000000000 * 1000) / 1000;
  // X: 采购复层单重 (吨) = E * M * Q * R / 1e9 (采购尺寸, 始终矩形)
  const X = Math.round(E * M * Q * R / 1000000000 * 1000) / 1000;
  // Y: 采购单重 (吨)
  const Y = W + X;
  // Z: 成品基层单重 (吨) = 7.85 * F * 成品面积 / 1e9 (圆形板用π*r²)
  const Z = Math.round(baseDensity * F * finishedArea_mm2 / 1000000000 * 1000) / 1000;
  // AA: 成品复层单重 (吨) = D * 成品面积 * R / 1e9 (圆形板用π*r²)
  const AA = Math.round(D * finishedArea_mm2 * R / 1000000000 * 1000) / 1000;
  // AB: 成品单重 (吨)
  const AB = Z + AA;
  // AC: 成品总重 (吨)
  const AC = AB * S;

  // ========== 成本计算 ==========
  const AN = DEFAULTS.passRate;        // 合格率
  const AJ = DEFAULTS.processingCostPerTon; // 前后道吨钢加工成本

  // AG: 单板成本 = (W * AE + X * AF) / 1.13 (材料成本, 不含税)
  const AG = (W * AE + X * AF) / DEFAULTS.taxRate;

  // AH: 吨钢成本 = AG / AB
  const AH = AB > 0 ? AG / AB : 0;

  // AI: 爆炸吨钢成本 = AD * T / AB / 1.13 + 85 / 1.09
  const AI = AB > 0
    ? (explosionPrice * T / AB / DEFAULTS.taxRate + 85 / DEFAULTS.transportTaxRate)
    : 0;

  // AO: 总成本(吨钢) = (AH + AI + AJ) / AN
  const AO = (AH + AI + AJ) / AN;

  // ========== 成材率 ==========
  const AK = W > 0 ? Z / W : 0;       // 基层成材率
  const AL = X > 0 ? AA / X : 0;      // 复层成材率
  const AM = Y > 0 ? AB / Y : 0;      // 合计成材率

  // ========== 报价与毛利 ==========
  const AQ = AP / DEFAULTS.taxRate - AO;    // 毛利 (元/吨)
  const AR = AQ * AC;                        // 毛利小计 (元)
  const AS = V > 0 ? AP * AC / V : 0;       // 单位面积报价 (元/㎡)

  // 来料加工
  const AU = (AI + AJ + AQ) * DEFAULTS.taxRate; // 来料加工吨钢价格
  const AV = V > 0 ? AU * AC / V : 0;           // 来料加工报价 (元/㎡)

  // ========== 组装结果 ==========

  const result = {
    // 输入参数
    input: {
      grade,
      claddingMaterial: getCladdingMaterial(grade),
      baseMaterial: getBaseMaterial(grade),
      claddingThickness: D,
      baseThickness: F,
      totalThickness: C,
      width: H,
      length: I,
      sheets: S,
      isCircular,
      purchaseCladdingThickness: E,
      purchaseBaseThickness: G,
      carbonSteelPrice: AE,
      stainlessSteelPrice: AF,
      quotationPerTon: AP,
    },

    // 尺寸参数
    dimensions: {
      baseWidening,
      claddingWidening,
      baseLengthening,
      claddingLengthening,
      asmeExtra,
      marginSource: stdMargins.marginSource,
      conditionDesc: stdMargins.conditionDesc,
      thicknessTolerance: stdMargins.thicknessTolerance,
      basePurchaseWidth: K,
      claddingPurchaseWidth: M,
      basePurchaseLength: O,
      claddingPurchaseLength: Q,
    },

    // 面积
    area: {
      explosionAreaPerSheet: T,  // 单板爆炸面积 ㎡
      finishedAreaPerSheet: U,   // 单板成品面积 ㎡
      totalFinishedArea: V,      // 成品总面积 ㎡
    },

    // 重量
    weight: {
      purchaseBaseWeight: W,      // 采购基层单重 吨
      purchaseCladdingWeight: X,  // 采购复层单重 吨
      purchaseTotalWeight: Y,     // 采购单重 吨
      finishedBaseWeight: Z,      // 成品基层单重 吨
      finishedCladdingWeight: AA, // 成品复层单重 吨
      finishedUnitWeight: AB,     // 成品单重 吨
      finishedTotalWeight: AC,    // 成品总重 吨
    },

    // 成本
    cost: {
      explosionPrice: explosionPrice,     // 爆炸单价 元/㎡
      materialCostPerSheet: AG,           // 单板材料成本 元
      materialCostPerTon: AH,             // 吨钢材料成本 元/吨
      explosionCostPerTon: AI,            // 爆炸吨钢成本 元/吨
      processingCostPerTon: AJ,           // 前后道加工成本 元/吨
      totalCostPerTon: AO,               // 吨钢总成本 元/吨
      passRate: AN,                       // 合格率
    },

    // 成材率
    yield: {
      baseYield: AK,          // 基层成材率
      claddingYield: AL,      // 复层成材率
      totalYield: AM,         // 合计成材率
    },

    // 报价与毛利
    profit: {
      quotationPerTon: AP,           // 吨钢报价 元/吨
      grossProfitPerTon: AQ,         // 毛利 元/吨
      totalGrossProfit: AR,          // 毛利小计 元
      quotationPerSqm: AS,           // 单位面积报价 元/㎡
      processingPricePerTon: AU,     // 来料加工吨钢价格
      processingPricePerSqm: AV,     // 来料加工报价 元/㎡
      materialTotalCost: AG * S,     // 材料总成本
      totalCost: AO * AC,            // 总成本
      totalRevenue: AP / DEFAULTS.taxRate * AC, // 不含税总收入
    },

    // 材料属性
    material: {
      claddingDensity: R,
      baseDensity: baseDensity,
      explosionPrice: explosionPrice,
    },
  };

  return result;
}

// ========== 拼焊/倍尺方案设计 ==========

/**
 * 设计拼焊/倍尺方案
 * @param {Object} input - 成品参数 (grade, claddingThickness, baseThickness, width, length, sheets, isCircular, options)
 * @returns {Object} 方案设计结果
 */
function designLayoutPlan(input) {
  const design = designRawMaterial(input);
  const { grade, width: H, length: I, sheets: S, isCircular } = design.input;
  const M = design.rawMaterial.claddingPurchaseWidth;
  const Q = design.rawMaterial.claddingPurchaseLength;
  const K = design.rawMaterial.basePurchaseWidth;
  const O = design.rawMaterial.basePurchaseLength;

  const claddingMat = getCladdingMaterial(grade);
  const category = MATERIAL_CATEGORY[claddingMat] || 'austenitic';
  const isStainless = category !== 'titanium';

  // 判断是否需要拼焊
  const needsWelding = isStainless && M > 2500;
  // 判断是否需要倍尺 (采购长度超过8000 或多张小板可合并节省材料)
  const needsMultiBlank = !isCircular && (O > MAX_PURCHASE_LENGTH || (S > 1 && I <= 4000));

  const plans = [];

  // ---- 拼焊方案 ----
  if (needsWelding) {
    const weldPlan = designWeldingPlan(M, Q, H, I);
    if (weldPlan) {
      const weldLength_m = weldPlan.totalWeldLength / 1000;
      const weldCost = Math.round(weldLength_m * PROCESSING_FEES.welding.price);
      plans.push({
        type: 'welding',
        title: '拼焊方案',
        reason: `覆层采购宽度 ${M}mm 超过最大标准宽度 2500mm`,
        ...weldPlan,
        weldLength_m: weldLength_m.toFixed(1),
        weldCost: weldCost,
        weldPricePerM: PROCESSING_FEES.welding.price,
      });
    }
  }

  // ---- 倍尺方案 ----
  if (needsMultiBlank && !isCircular) {
    const multiPlan = designMultiBlankPlan(H, I, S, K, O, M, Q);
    if (multiPlan && multiPlan.best) {
      // 仅在以下情况展示倍尺方案：
      // 1. 采购长度超过最大长度（必须倍尺）
      // 2. 排列数 > 1 且节省率 > 0（有实际节省）
      const mustSplit = O > MAX_PURCHASE_LENGTH;
      const hasSaving = multiPlan.best.perPlate > 1 && parseFloat(multiPlan.best.savingRate) > 0;
      if (mustSplit || hasSaving) {
        plans.push({
          type: 'multiblank',
          title: '倍尺方案',
          reason: mustSplit
            ? `基层采购长度 ${O}mm 超过最大长度 ${MAX_PURCHASE_LENGTH}mm，需倍尺排列`
            : `${S}张成品可合并排列以节省材料`,
          ...multiPlan,
        });
      }
    }
  }

  // ---- 无需特殊方案 ----
  if (plans.length === 0) {
    plans.push({
      type: 'none',
      title: '标准方案',
      reason: '采购尺寸符合标准，无需拼焊或倍尺',
    });
  }

  // ===== 计算排版后的调整采购尺寸 =====
  const weldPlan = plans.find(p => p.type === 'welding');
  const multiPlan = plans.find(p => p.type === 'multiblank' && p.best);

  let adjJ = K;       // 基层采购宽 (默认=基础)
  let adjL = O;       // 基层采购长 (默认=基础)
  let adjK = M;       // 复层采购宽 (默认=基础)
  let adjM = Q;       // 复层采购长 (默认=基础)
  let materialCount = S;  // 材料数量(板数), 默认=张数
  let adjusted = false;
  const reasons = [];

  // 拼焊调整: 复层采购宽 → 标准板宽 × 条带数
  if (weldPlan && weldPlan.strips && weldPlan.strips.length > 0) {
    const stdW = weldPlan.strips[0].standardWidth;
    const stripCount = weldPlan.stripCount;
    adjK = stdW * stripCount;
    adjusted = true;
    reasons.push(`拼焊: 复层采购宽 ${M}mm → ${stripCount}×${stdW}=${adjK}mm`);
  }

  // 倍尺调整: 基层/复层采购尺寸 → 倍尺板尺寸, 材料数量 → 板数
  if (multiPlan) {
    const best = multiPlan.best;
    const cladPW_orig = M;
    const basePW_orig = K;
    const cladPL_orig = Q;
    const basePL_orig = O;
    const widthChanged = best.cols > 1;
    const lengthChanged = best.rows > 1;

    // 基层板尺寸
    adjJ = best.plateWidth;
    adjL = best.plateLength;

    // 复层板尺寸: 保持复层对基层的额外余量
    if (widthChanged) {
      adjK = best.plateWidth + 2 * (cladPW_orig - basePW_orig);
    }
    if (lengthChanged) {
      adjM = best.plateLength + 2 * (cladPL_orig - basePL_orig);
    }

    materialCount = best.platesNeeded;
    adjusted = true;
    reasons.push(`倍尺: 基层 ${K}×${O}mm → ${best.plateWidth}×${best.plateLength}mm (${best.arrangement}, ${best.perPlate}张/板, ${best.platesNeeded}板)`);
  }

  return {
    input: design.input,
    rawMaterial: design.rawMaterial,
    margins: design.margins,
    plans,
    warnings: design.warnings,
    adjustedDims: {
      basePurchaseWidth: adjJ,           // J' 基层采购宽(排版后)
      basePurchaseLength: adjL,          // L' 基层采购长(排版后)
      claddingPurchaseWidth: adjK,       // K' 复层采购宽(排版后)
      claddingPurchaseLength: adjM,      // M' 复层采购长(排版后)
      materialCount,                     // P' 材料数量(板数)
      originalSheets: S,                 // P 原始张数
      adjusted,
      adjustmentReason: reasons.join('; '),
    },
  };
}

/**
 * 同一订单跨产品共版条带设计。
 * 仅合并相同复层牌号、相同复层厚度且需拼焊的矩形板；基层和长度仍按各产品自身规格计算。
 * 每组统一选择一个标准板宽，并按各产品的实际采购宽度分配条带数。
 * @param {Array<Object>} allItems - 同一订单内的全部成品参数
 * @returns {Object} { layoutByIndex, groups }
 */
function designSharedLayout(allItems = []) {
  const layoutByIndex = allItems.map(item => designLayoutPlan(item));
  const candidatesByGroup = new Map();

  allItems.forEach((item, index) => {
    if (item.isCircular) return;
    const raw = designRawMaterial(item);
    const claddingMaterial = getCladdingMaterial(item.grade);
    const category = MATERIAL_CATEGORY[claddingMaterial] || 'austenitic';
    const claddingWidth = raw.rawMaterial.claddingPurchaseWidth;

    // 钛材不使用不锈钢标准条带；宽度未超2500mm时无需拼焊。
    if (category === 'titanium' || claddingWidth <= 2500) return;

    const key = `${claddingMaterial}|${item.claddingThickness}`;
    if (!candidatesByGroup.has(key)) candidatesByGroup.set(key, []);
    candidatesByGroup.get(key).push({
      index,
      item,
      raw,
      claddingMaterial,
      claddingWidth,
      claddingLength: raw.rawMaterial.claddingPurchaseLength,
      sheets: Math.max(1, Number(item.sheets) || 1),
    });
  });

  const groups = [];
  for (const [key, members] of candidatesByGroup) {
    // 单一规格继续沿用原单品拼焊方案，不标记为跨产品共版。
    if (members.length < 2) continue;

    let best = null;
    for (const standardWidth of STANDARD_STAINLESS_WIDTHS) {
      const allocations = [];
      let totalStripDemand = 0;
      let totalDemandArea = 0;
      let totalPurchaseArea = 0;
      let valid = true;

      members.forEach(member => {
        const stripCount = Math.ceil(member.claddingWidth / standardWidth);
        if (stripCount < 2 || stripCount > 4) {
          valid = false;
          return;
        }
        const stripWidths = [];
        let remaining = member.claddingWidth;
        for (let n = 0; n < stripCount; n++) {
          const actualWidth = n === stripCount - 1
            ? Math.round(remaining)
            : Math.round(member.claddingWidth / stripCount);
          remaining -= actualWidth;
          stripWidths.push(actualWidth);
        }
        const demandArea = member.claddingWidth * member.claddingLength * member.sheets / 1e6;
        const purchaseArea = standardWidth * stripCount * member.claddingLength * member.sheets / 1e6;
        totalStripDemand += stripCount * member.sheets;
        totalDemandArea += demandArea;
        totalPurchaseArea += purchaseArea;
        allocations.push({ ...member, stripCount, stripWidths, demandArea, purchaseArea });
      });

      if (!valid) continue;
      const wasteArea = totalPurchaseArea - totalDemandArea;
      const score = wasteArea * 1000 + totalStripDemand;
      if (!best || score < best.score) {
        best = { standardWidth, allocations, totalStripDemand, totalDemandArea, totalPurchaseArea, wasteArea, score };
      }
    }

    if (!best) continue;

    const groupId = `shared_${groups.length + 1}`;
    const group = {
      id: groupId,
      key,
      claddingMaterial: members[0].claddingMaterial,
      claddingThickness: members[0].item.claddingThickness,
      standardWidth: best.standardWidth,
      productIndexes: members.map(member => member.index),
      totalStripDemand: best.totalStripDemand,
      totalDemandArea: best.totalDemandArea,
      totalPurchaseArea: best.totalPurchaseArea,
      wasteArea: best.wasteArea,
      allocations: [],
    };

    best.allocations.forEach(allocation => {
      const original = layoutByIndex[allocation.index];
      const plansWithoutIndividualWelding = original.plans.filter(plan => plan.type !== 'welding');
      const weldPositions = allocation.stripWidths.slice(0, -1).reduce((positions, width) => {
        const previous = positions.length ? positions[positions.length - 1] : 0;
        positions.push(previous + width);
        return positions;
      }, []);
      const totalWeldLength = (allocation.stripCount - 1) * allocation.claddingLength;
      const sharedWeldPlan = {
        type: 'welding',
        title: '同订单共版拼焊方案',
        reason: `与第${group.productIndexes.map(i => i + 1).join('、')}项共用${best.standardWidth}mm标准条带`,
        sharedLayout: true,
        sharedGroupId: groupId,
        stripCount: allocation.stripCount,
        strips: allocation.stripWidths.map((actualWidth, idx) => ({
          index: idx + 1,
          standardWidth: best.standardWidth,
          actualWidth,
          wasteWidth: best.standardWidth - actualWidth,
        })),
        weldPositions,
        totalWeldLength,
        weldLength_m: (totalWeldLength / 1000).toFixed(1),
        weldCost: Math.round(totalWeldLength / 1000 * PROCESSING_FEES.welding.price),
        weldPricePerM: PROCESSING_FEES.welding.price,
        wasteWidth: best.standardWidth * allocation.stripCount - allocation.claddingWidth,
        wasteArea: (best.standardWidth * allocation.stripCount - allocation.claddingWidth) * allocation.claddingLength / 1e6,
      };
      plansWithoutIndividualWelding.unshift(sharedWeldPlan);

      const adjustedDims = {
        ...original.adjustedDims,
        claddingPurchaseWidth: best.standardWidth * allocation.stripCount,
        adjusted: true,
        sharedLayout: true,
        sharedGroupId: groupId,
        sharedStandardWidth: best.standardWidth,
        sharedStripCount: allocation.stripCount,
        adjustmentReason: `${original.adjustedDims.adjustmentReason ? original.adjustedDims.adjustmentReason + '; ' : ''}同订单共版: ${allocation.stripCount}×${best.standardWidth}=${best.standardWidth * allocation.stripCount}mm`,
      };
      layoutByIndex[allocation.index] = { ...original, plans: plansWithoutIndividualWelding, adjustedDims };
      group.allocations.push({
        index: allocation.index,
        sheets: allocation.sheets,
        claddingWidth: allocation.claddingWidth,
        claddingLength: allocation.claddingLength,
        stripCount: allocation.stripCount,
        stripWidths: allocation.stripWidths,
        demandArea: allocation.demandArea,
        purchaseArea: allocation.purchaseArea,
      });
    });

    groups.push(group);
  }

  // ===== 跨产品共版倍尺 =====
  // 按基层牌号+基层厚度分组（同组可共用基板）
  const mbCandidatesByGroup = new Map();

  allItems.forEach((item, index) => {
    if (item.isCircular) return;
    const baseMaterial = getBaseMaterial(item.grade);
    const key = `${baseMaterial}|${item.baseThickness}`;
    if (!mbCandidatesByGroup.has(key)) mbCandidatesByGroup.set(key, []);

    const currentLayout = layoutByIndex[index];
    const adj = currentLayout.adjustedDims;

    mbCandidatesByGroup.get(key).push({
      index,
      item,
      finishedWidth: item.width,
      finishedLength: item.length,
      sheets: Math.max(1, Number(item.sheets) || 1),
      basePurchaseWidth: adj.basePurchaseWidth,
      basePurchaseLength: adj.basePurchaseLength,
      claddingPurchaseWidth: adj.claddingPurchaseWidth,
      claddingPurchaseLength: adj.claddingPurchaseLength,
    });
  });

  for (const [mbKey, mbMembers] of mbCandidatesByGroup) {
    // 需要至少2个不同产品
    if (mbMembers.length < 2) continue;

    // 按成品宽度子分组（相同宽度才能沿长度方向共板）
    const byWidth = new Map();
    mbMembers.forEach(m => {
      if (!byWidth.has(m.finishedWidth)) byWidth.set(m.finishedWidth, []);
      byWidth.get(m.finishedWidth).push(m);
    });

    for (const [width, mbGroup] of byWidth) {
      const totalPieces = mbGroup.reduce((sum, m) => sum + m.sheets, 0);
      if (totalPieces < 2) continue;

      // 收集所有成品件
      const mbMargins = { baseL: 40, cutGap: 10 };
      const pieces = [];
      mbGroup.forEach(m => {
        for (let i = 0; i < m.sheets; i++) {
          pieces.push({ memberIndex: m.index, length: m.finishedLength });
        }
      });
      pieces.sort((a, b) => b.length - a.length);

      // 尝试不同的每板件数
      let mbBest = null;
      for (let perPlate = 2; perPlate <= Math.min(pieces.length, 4); perPlate++) {
        // 检查 perPlate 件最长成品是否能放下
        const longestCombo = pieces.slice(0, perPlate).reduce((sum, p, i) =>
          sum + p.length + (i > 0 ? mbMargins.cutGap : 0), 2 * mbMargins.baseL);
        if (longestCombo > MAX_PURCHASE_LENGTH) continue;

        // 贪心排列：最长配最短
        const remaining = [...pieces];
        const plates = [];
        while (remaining.length > 0) {
          const platePieces = [remaining.shift()];
          let plateLength = platePieces[0].length + 2 * mbMargins.baseL;
          while (platePieces.length < perPlate && remaining.length > 0) {
            const shortest = remaining[remaining.length - 1];
            const newLength = plateLength + shortest.length + mbMargins.cutGap;
            if (newLength > MAX_PURCHASE_LENGTH) break;
            platePieces.push(remaining.pop());
            plateLength = newLength;
          }
          plates.push({ pieces: platePieces, length: Math.round(plateLength) });
        }

        // 计算节省（对比每件独立1板）
        const individualPlates = totalPieces;
        const savings = individualPlates - plates.length;
        if (savings <= 0) continue;

        if (!mbBest || plates.length < mbBest.plates.length) {
          mbBest = { perPlate, plates, savings };
        }
      }

      if (!mbBest) continue;

      // 计算各产品的加权平均板长和板数
      const productInfo = new Map();
      mbGroup.forEach(m => productInfo.set(m.index, { plateLengths: [], plateCount: 0 }));

      mbBest.plates.forEach(plate => {
        const membersOnPlate = new Set(plate.pieces.map(p => p.memberIndex));
        membersOnPlate.forEach(memberIndex => {
          const info = productInfo.get(memberIndex);
          info.plateLengths.push(plate.length);
          info.plateCount++;
        });
      });

      const mbGroupId = `mb_${groups.length + 1}`;
      groups.push({
        id: mbGroupId,
        type: 'multiblank',
        key: `${mbKey}|w${width}`,
        baseMaterial: getBaseMaterial(mbGroup[0].item.grade),
        baseThickness: mbGroup[0].item.baseThickness,
        finishedWidth: width,
        productIndexes: mbGroup.map(m => m.index),
        perPlate: mbBest.perPlate,
        platesNeeded: mbBest.plates.length,
        individualPlates: totalPieces,
        savings: mbBest.savings,
        plateWidth: mbGroup[0].basePurchaseWidth,
        arrangement: mbBest.plates.map((p, i) =>
          `板${i + 1}: ${p.pieces.map(pc => pc.length + 'mm').join(' + ')}`),
      });

      // 更新各产品的 adjustedDims
      mbGroup.forEach(m => {
        const original = layoutByIndex[m.index];
        const existingAdj = original.adjustedDims;
        const info = productInfo.get(m.index);
        const avgPlateLength = Math.round(info.plateLengths.reduce((a, b) => a + b, 0) / info.plateCount);
        const cladExtraL = m.claddingPurchaseLength - m.basePurchaseLength;

        const updatedDims = {
          ...existingAdj,
          basePurchaseLength: avgPlateLength,
          claddingPurchaseLength: avgPlateLength + cladExtraL,
          materialCount: info.plateCount,
          adjusted: true,
          sharedMultiBlank: true,
          sharedMultiBlankGroupId: mbGroupId,
          adjustmentReason: `${existingAdj.adjustmentReason ? existingAdj.adjustmentReason + '; ' : ''}跨产品倍尺: 基层采购长 ${m.basePurchaseLength}mm → ${avgPlateLength}mm (${mbBest.perPlate}件/板, ${info.plateCount}板)`,
        };
        layoutByIndex[m.index] = { ...original, adjustedDims: updatedDims };
      });
    }
  }

  return { layoutByIndex, groups };
}

/**
 * 拼焊方案：将覆层采购宽度拆分为标准宽度条带
 */
function designWeldingPlan(purchaseWidth, purchaseLength, finishedWidth, finishedLength) {
  // 尝试不同的条带数量
  const maxStrips = 4;
  let bestPlan = null;

  for (let n = 2; n <= maxStrips; n++) {
    const plan = tryWeldingSplit(purchaseWidth, purchaseLength, n);
    if (plan && (!bestPlan || plan.score < bestPlan.score)) {
      bestPlan = plan;
    }
  }

  if (!bestPlan) return null;

  // 计算焊缝位置 (从覆层成品区起算)
  const strips = bestPlan.strips;
  let cumWidth = 0;
  const weldPositions = [];
  for (let i = 0; i < strips.length - 1; i++) {
    cumWidth += strips[i].actualWidth;
    weldPositions.push(Math.round(cumWidth));
  }

  // 焊缝总长 = (条带数-1) × 采购长度
  const totalWeldLength = (strips.length - 1) * purchaseLength;

  return {
    stripCount: strips.length,
    strips,
    weldPositions,
    totalWeldLength,
    wasteWidth: bestPlan.wasteWidth,
    wasteArea: bestPlan.wasteWidth * purchaseLength / 1000000,
    score: bestPlan.score,
  };
}

/**
 * 尝试将宽度拆分为n条标准宽度条带
 */
function tryWeldingSplit(targetWidth, purchaseLength, n) {
  // 每条带宽度
  const stripWidth = targetWidth / n;
  
  // 找到 >= stripWidth 的最小标准宽度
  const standardWidths = STANDARD_STAINLESS_WIDTHS;
  let bestStdWidth = null;
  let minWaste = Infinity;

  for (const sw of standardWidths) {
    if (sw >= stripWidth - 1) { // 允许1mm容差
      const waste = sw * n - targetWidth;
      if (waste < minWaste) {
        minWaste = waste;
        bestStdWidth = sw;
      }
    }
  }

  if (!bestStdWidth) return null;

  // 构建条带列表
  const strips = [];
  let remaining = targetWidth;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      // 最后一条带用剩余宽度
      strips.push({
        index: i + 1,
        standardWidth: bestStdWidth,
        actualWidth: Math.round(remaining),
        wasteWidth: bestStdWidth - Math.round(remaining),
      });
    } else {
      const w = Math.round(targetWidth / n);
      strips.push({
        index: i + 1,
        standardWidth: bestStdWidth,
        actualWidth: w,
        wasteWidth: bestStdWidth - w,
      });
      remaining -= w;
    }
  }

  const totalWaste = bestStdWidth * n - targetWidth;
  const score = n * 1000 + totalWaste; // 优先少条带，其次少废料

  return {
    strips,
    wasteWidth: Math.round(totalWaste),
    score,
  };
}

/**
 * 倍尺方案：多张成品排列在同一基板上
 */
function designMultiBlankPlan(finishedW, finishedL, sheets, basePW, basePL, cladPW, cladPL) {
  // 尝试不同的排列方式
  const options = [];
  const margins = { baseW: 40, baseL: 40, cutGap: 10 };

  // 尝试沿长度方向排列 (1×N)
  for (let n = 2; n <= Math.min(sheets, 6); n++) {  // n从2开始，1×1不是倍尺
    const totalL = n * finishedL + (n - 1) * margins.cutGap + 2 * margins.baseL;
    if (totalL <= MAX_PURCHASE_LENGTH) {
      const plateW = basePW;
      const plateL = Math.round(totalL);
      const plateArea = plateW * plateL / 1000000;
      const individualArea = basePW * basePL * n / 1000000;
      const saving = (individualArea - plateArea);
      const savingRate = individualArea > 0 ? saving / individualArea : 0;
      const platesNeeded = Math.ceil(sheets / n);

      options.push({
        arrangement: `1×${n}`,
        cols: 1,
        rows: n,
        perPlate: n,
        platesNeeded,
        plateWidth: plateW,
        plateLength: plateL,
        plateArea: plateArea.toFixed(2),
        individualArea: individualArea.toFixed(2),
        savingArea: saving.toFixed(2),
        savingRate: (savingRate * 100).toFixed(1),
        cutCount: n,
        score: platesNeeded * 10000 - savingRate * 100,
      });
    }
  }

  // 尝试沿宽度方向排列 (N×1)
  for (let n = 2; n <= Math.min(sheets, 4); n++) {
    const totalW = n * finishedW + (n - 1) * margins.cutGap + 2 * margins.baseW;
    if (totalW <= 2500) {
      const plateW = Math.round(totalW);
      const plateL = basePL;
      const plateArea = plateW * plateL / 1000000;
      const individualArea = basePW * basePL * n / 1000000;
      const saving = individualArea - plateArea;
      const savingRate = individualArea > 0 ? saving / individualArea : 0;
      const platesNeeded = Math.ceil(sheets / n);

      options.push({
        arrangement: `${n}×1`,
        cols: n,
        rows: 1,
        perPlate: n,
        platesNeeded,
        plateWidth: plateW,
        plateLength: plateL,
        plateArea: plateArea.toFixed(2),
        individualArea: individualArea.toFixed(2),
        savingArea: saving.toFixed(2),
        savingRate: (savingRate * 100).toFixed(1),
        cutCount: n,
        score: platesNeeded * 10000 - savingRate * 100,
      });
    }
  }

  // 尝试网格排列 (M×N)
  for (let cols = 2; cols <= 3; cols++) {
    for (let rows = 2; rows <= 4; rows++) {
      const totalW = cols * finishedW + (cols - 1) * margins.cutGap + 2 * margins.baseW;
      const totalL = rows * finishedL + (rows - 1) * margins.cutGap + 2 * margins.baseL;
      if (totalW <= 2500 && totalL <= MAX_PURCHASE_LENGTH) {
        const perPlate = cols * rows;
        if (perPlate > sheets) continue;
        const plateW = Math.round(totalW);
        const plateL = Math.round(totalL);
        const plateArea = plateW * plateL / 1000000;
        const individualArea = basePW * basePL * perPlate / 1000000;
        const saving = individualArea - plateArea;
        const savingRate = individualArea > 0 ? saving / individualArea : 0;
        const platesNeeded = Math.ceil(sheets / perPlate);

        options.push({
          arrangement: `${cols}×${rows}`,
          cols,
          rows,
          perPlate,
          platesNeeded,
          plateWidth: plateW,
          plateLength: plateL,
          plateArea: plateArea.toFixed(2),
          individualArea: individualArea.toFixed(2),
          savingArea: saving.toFixed(2),
          savingRate: (savingRate * 100).toFixed(1),
          cutCount: cols * rows,
          score: platesNeeded * 10000 - savingRate * 100,
        });
      }
    }
  }

  if (options.length === 0) return null;

  // 过滤掉节省率为负的选项（除非是因为长度超限必须倍尺）
  const hasPositiveSaving = options.some(o => parseFloat(o.savingRate) > 0);
  let filtered = hasPositiveSaving
    ? options.filter(o => parseFloat(o.savingRate) > 0)
    : options;

  // 选择最优方案：最少基板数 + 最大节省率
  filtered.sort((a, b) => a.score - b.score);
  const best = filtered[0];
  const allOptions = filtered.slice(0, 3); // 返回前3个方案

  return { best, allOptions };
}

/**
 * 生成拼焊布局SVG图纸
 */
function generateWeldingDrawing(plan, rawMaterial, inputInfo) {
  const M = rawMaterial.claddingPurchaseWidth || 0;
  const Q = rawMaterial.claddingPurchaseLength || 0;
  const K = rawMaterial.basePurchaseWidth || 0;
  const O = rawMaterial.basePurchaseLength || 0;
  const H = (inputInfo && inputInfo.width) || 0;
  const I = (inputInfo && inputInfo.length) || 0;
  const isCircular = (inputInfo && inputInfo.isCircular) || false;

  if (plan.type === 'welding' && plan.strips) {
    return generateWeldingSVG(plan, M, Q, K, O, H, I);
  } else if (plan.type === 'multiblank' && plan.best) {
    return generateMultiBlankSVG(plan.best, H, I, K, O);
  } else if (plan.type === 'none') {
    return generateStandardSVG(M, Q, K, O, H, I, isCircular);
  }
  return '';
}

/**
 * 拼焊SVG图纸
 */
function generateWeldingSVG(plan, M, Q, K, O, H, I) {
  const padding = 60;
  const labelOffset = 30;
  const maxW = 600;
  const maxH = 400;
  const scale = Math.min((maxW - 2 * padding) / Math.max(M, K), (maxH - 2 * padding) / Math.max(Q, O));
  const w = Math.max(M, K) * scale + 2 * padding;
  const h = Math.max(Q, O) * scale + 2 * padding + labelOffset;
  const ox = padding;
  const oy = padding;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:600px;">`;
  svg += `<defs><pattern id="weldHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="6" stroke="#dc2626" stroke-width="1" opacity="0.5"/>
  </pattern></defs>`;

  // 基层 (外框)
  const baseW = K * scale;
  const baseH = O * scale;
  const baseX = ox + (M * scale - baseW) / 2;
  const baseY = oy + (Q * scale - baseH) / 2;
  svg += `<rect x="${baseX}" y="${baseY}" width="${baseW}" height="${baseH}" fill="#dbeafe" stroke="#3b82f6" stroke-width="2" rx="2"/>`;
  svg += `<text x="${baseX + baseW/2}" y="${baseY - 6}" text-anchor="middle" font-size="11" fill="#1e40af" font-weight="600">基层 ${K}×${O}mm</text>`;

  // 覆层条带
  let cumX = ox;
  const cladH = Q * scale;
  plan.strips.forEach((strip, idx) => {
    const sw = strip.actualWidth * scale;
    const colors = ['#10b981', '#059669', '#047857', '#065f46'];
    const fill = colors[idx % colors.length];
    svg += `<rect x="${cumX}" y="${oy}" width="${sw}" height="${cladH}" fill="${fill}" fill-opacity="0.3" stroke="${fill}" stroke-width="1.5" rx="1"/>`;
    // 条带编号
    svg += `<text x="${cumX + sw/2}" y="${oy + cladH/2}" text-anchor="middle" font-size="12" fill="${fill}" font-weight="700">${strip.index}</text>`;
    // 条带宽度标注
    svg += `<text x="${cumX + sw/2}" y="${oy + cladH + 14}" text-anchor="middle" font-size="9" fill="#374151">${strip.actualWidth}mm</text>`;
    // 标准宽度
    svg += `<text x="${cumX + sw/2}" y="${oy + cladH + 26}" text-anchor="middle" font-size="8" fill="#9ca3af">(标准${strip.standardWidth})</text>`;
    cumX += sw;
  });

  // 焊缝线
  let weldX = ox;
  plan.strips.forEach((strip, idx) => {
    if (idx < plan.strips.length - 1) {
      weldX += strip.actualWidth * scale;
      svg += `<line x1="${weldX}" y1="${oy}" x2="${weldX}" y2="${oy + cladH}" stroke="#dc2626" stroke-width="3" stroke-dasharray="6,3"/>`;
      svg += `<rect x="${weldX-3}" y="${oy}" width="6" height="${cladH}" fill="url(#weldHatch)" opacity="0.6"/>`;
      // 焊缝标注
      svg += `<text x="${weldX + 5}" y="${oy + 16}" font-size="9" fill="#dc2626" font-weight="600">焊缝${idx+1}</text>`;
    }
  });

  // 尺寸标注 - 总宽度
  const dimY = oy + cladH + 40;
  svg += `<line x1="${ox}" y1="${dimY}" x2="${ox + M*scale}" y2="${dimY}" stroke="#6b7280" stroke-width="1"/>`;
  svg += `<line x1="${ox}" y1="${dimY-4}" x2="${ox}" y2="${dimY+4}" stroke="#6b7280" stroke-width="1"/>`;
  svg += `<line x1="${ox + M*scale}" y1="${dimY-4}" x2="${ox + M*scale}" y2="${dimY+4}" stroke="#6b7280" stroke-width="1"/>`;
  svg += `<text x="${ox + M*scale/2}" y="${dimY + 14}" text-anchor="middle" font-size="11" fill="#374151" font-weight="600">覆层总宽 ${M}mm</text>`;

  // 长度标注 (左侧)
  const dimX = ox - 25;
  svg += `<line x1="${dimX}" y1="${oy}" x2="${dimX}" y2="${oy + cladH}" stroke="#6b7280" stroke-width="1"/>`;
  svg += `<line x1="${dimX-4}" y1="${oy}" x2="${dimX+4}" y2="${oy}" stroke="#6b7280" stroke-width="1"/>`;
  svg += `<line x1="${dimX-4}" y1="${oy+cladH}" x2="${dimX+4}" y2="${oy+cladH}" stroke="#6b7280" stroke-width="1"/>`;
  svg += `<text x="${dimX - 8}" y="${oy + cladH/2}" text-anchor="middle" font-size="11" fill="#374151" font-weight="600" transform="rotate(-90, ${dimX-8}, ${oy+cladH/2})">覆层长 ${Q}mm</text>`;

  // 图例
  svg += `<rect x="${w - 150}" y="${h - 50}" width="12" height="12" fill="#10b981" fill-opacity="0.3" stroke="#10b981"/>`;
  svg += `<text x="${w - 132}" y="${h - 40}" font-size="9" fill="#374151">覆层条带</text>`;
  svg += `<rect x="${w - 150}" y="${h - 32}" width="12" height="12" fill="#dbeafe" stroke="#3b82f6"/>`;
  svg += `<text x="${w - 132}" y="${h - 22}" font-size="9" fill="#374151">基层钢板</text>`;
  svg += `<line x1="${w - 150}" y1="${h - 12}" x2="${w - 138}" y2="${h - 12}" stroke="#dc2626" stroke-width="2" stroke-dasharray="4,2"/>`;
  svg += `<text x="${w - 132}" y="${h - 8}" font-size="9" fill="#374151">焊缝位置</text>`;

  svg += `</svg>`;
  return svg;
}

/**
 * 倍尺SVG图纸
 */
function generateMultiBlankSVG(best, H, I, K, O) {
  const padding = 60;
  const labelOffset = 30;
  const maxW = 600;
  const maxH = 450;
  const scale = Math.min((maxW - 2 * padding) / best.plateWidth, (maxH - 2 * padding) / best.plateLength);
  const w = best.plateWidth * scale + 2 * padding;
  const h = best.plateLength * scale + 2 * padding + labelOffset;
  const ox = padding;
  const oy = padding;

  const plateW = best.plateWidth * scale;
  const plateH = best.plateLength * scale;
  const margin = 40 * scale;
  const cutGap = 10 * scale;
  const pieceW = H * scale;
  const pieceH = I * scale;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:600px;">`;

  // 基板外框
  svg += `<rect x="${ox}" y="${oy}" width="${plateW}" height="${plateH}" fill="#dbeafe" stroke="#3b82f6" stroke-width="2" rx="2"/>`;
  svg += `<text x="${ox + plateW/2}" y="${oy - 6}" text-anchor="middle" font-size="11" fill="#1e40af" font-weight="600">基板 ${best.plateWidth}×${best.plateLength}mm (${best.arrangement})</text>`;

  // 成品块
  const cols = best.cols;
  const rows = best.rows;
  const startX = ox + margin;
  const startY = oy + margin;
  let pieceNum = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pieceNum >= best.perPlate) break;
      const x = startX + c * (pieceW + cutGap);
      const y = startY + r * (pieceH + cutGap);
      svg += `<rect x="${x}" y="${y}" width="${pieceW}" height="${pieceH}" fill="#10b981" fill-opacity="0.2" stroke="#059669" stroke-width="1.5" rx="1"/>`;
      svg += `<text x="${x + pieceW/2}" y="${y + pieceH/2}" text-anchor="middle" font-size="14" fill="#065f46" font-weight="700">${pieceNum + 1}</text>`;
      // 尺寸标注
      if (pieceW > 40) {
        svg += `<text x="${x + pieceW/2}" y="${y + pieceH/2 + 14}" text-anchor="middle" font-size="8" fill="#374151">${H}×${I}</text>`;
      }
      pieceNum++;
    }
  }

  // 切割线
  if (cols > 1) {
    for (let c = 1; c < cols; c++) {
      const x = startX + c * pieceW + (c - 1) * cutGap + cutGap / 2;
      svg += `<line x1="${x}" y1="${oy + margin}" x2="${x}" y2="${oy + plateH - margin}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5,3"/>`;
    }
  }
  if (rows > 1) {
    for (let r = 1; r < rows; r++) {
      const y = startY + r * pieceH + (r - 1) * cutGap + cutGap / 2;
      svg += `<line x1="${ox + margin}" y1="${y}" x2="${ox + plateW - margin}" y2="${y}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5,3"/>`;
    }
  }

  // 余量标注
  svg += `<text x="${ox + 4}" y="${oy + plateH/2}" font-size="8" fill="#9ca3af" transform="rotate(-90, ${ox+4}, ${oy+plateH/2})">余量40mm</text>`;
  svg += `<text x="${ox + plateW/2}" y="${oy + plateH - 4}" text-anchor="middle" font-size="8" fill="#9ca3af">余量40mm</text>`;

  // 尺寸标注
  const dimY = oy + plateH + 18;
  svg += `<line x1="${ox}" y1="${dimY}" x2="${ox + plateW}" y2="${dimY}" stroke="#6b7280" stroke-width="1"/>`;
  svg += `<text x="${ox + plateW/2}" y="${dimY + 12}" text-anchor="middle" font-size="10" fill="#374151" font-weight="600">${best.plateWidth}mm</text>`;

  const dimX = ox - 18;
  svg += `<line x1="${dimX}" y1="${oy}" x2="${dimX}" y2="${oy + plateH}" stroke="#6b7280" stroke-width="1"/>`;
  svg += `<text x="${dimX - 4}" y="${oy + plateH/2}" text-anchor="middle" font-size="10" fill="#374151" font-weight="600" transform="rotate(-90, ${dimX-4}, ${oy+plateH/2})">${best.plateLength}mm</text>`;

  // 图例
  svg += `<rect x="${w - 130}" y="${h - 45}" width="12" height="12" fill="#10b981" fill-opacity="0.2" stroke="#059669"/>`;
  svg += `<text x="${w - 112}" y="${h - 35}" font-size="9" fill="#374151">成品(${H}×${I}mm)</text>`;
  svg += `<line x1="${w - 130}" y1="${h - 20}" x2="${w - 118}" y2="${h - 20}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,2"/>`;
  svg += `<text x="${w - 112}" y="${h - 16}" font-size="9" fill="#374151">切割线</text>`;

  // 节省信息
  svg += `<text x="${ox}" y="${h - 6}" font-size="9" fill="#059669" font-weight="600">节省材料 ${best.savingArea}㎡ (${best.savingRate}%) | 需${best.platesNeeded}块基板</text>`;

  svg += `</svg>`;
  return svg;
}

/**
 * 标准方案SVG (无需拼焊/倍尺)
 */
function generateStandardSVG(M, Q, K, O, H, I, isCircular) {
  const padding = 60;
  const labelOffset = 30;
  const maxW = 500;
  const maxH = 350;
  const scale = Math.min((maxW - 2 * padding) / Math.max(M, K), (maxH - 2 * padding) / Math.max(Q, O));
  const w = Math.max(M, K) * scale + 2 * padding;
  const h = Math.max(Q, O) * scale + 2 * padding + labelOffset;
  const ox = padding;
  const oy = padding;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:500px;">`;

  // 基层
  const baseW = K * scale;
  const baseH = O * scale;
  const baseX = ox + (M * scale - baseW) / 2;
  const baseY = oy + (Q * scale - baseH) / 2;
  svg += `<rect x="${baseX}" y="${baseY}" width="${baseW}" height="${baseH}" fill="#dbeafe" stroke="#3b82f6" stroke-width="2" rx="2"/>`;
  svg += `<text x="${baseX + baseW/2}" y="${baseY - 6}" text-anchor="middle" font-size="11" fill="#1e40af" font-weight="600">基层 ${K}×${O}mm</text>`;

  // 覆层
  const cladW = M * scale;
  const cladH = Q * scale;
  if (isCircular) {
    const cx = ox + cladW / 2;
    const cy = oy + cladH / 2;
    const r = Math.min(cladW, cladH) / 2;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#10b981" fill-opacity="0.3" stroke="#059669" stroke-width="2"/>`;
    svg += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="12" fill="#065f46" font-weight="600">成品</text>`;
    svg += `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="10" fill="#065f46">Ф${H}mm</text>`;
  } else {
    svg += `<rect x="${ox}" y="${oy}" width="${cladW}" height="${cladH}" fill="#10b981" fill-opacity="0.3" stroke="#059669" stroke-width="2" rx="1"/>`;
    svg += `<text x="${ox + cladW/2}" y="${oy + cladH/2}" text-anchor="middle" font-size="12" fill="#065f46" font-weight="600">覆层 ${M}×${Q}mm</text>`;
  }

  // 尺寸标注
  const dimY = oy + Math.max(cladH, baseH) + 18;
  svg += `<line x1="${ox}" y1="${dimY}" x2="${ox + cladW}" y2="${dimY}" stroke="#6b7280" stroke-width="1"/>`;
  svg += `<text x="${ox + cladW/2}" y="${dimY + 12}" text-anchor="middle" font-size="10" fill="#374151" font-weight="600">${M}mm</text>`;

  svg += `</svg>`;
  return svg;
}

// ========== 工序成本计算 (按Excel毛利表逻辑) ==========

/**
 * 计算单条订单的工序成本明细
 * 完全按照"爆炸毛利表-成本0804.xlsx"的毛利表sheet公式逻辑
 * 原材料规格(J/K/L/M)从网页第一页自动填入
 * 毛利需要手动填入单价(含税元/吨)或总金额(含税元)才能计算
 *
 * @param {Object} item - 订单参数
 * @param {Object} rawMaterial - designRawMaterial 返回结果
 * @param {Object} layoutPlan - designLayoutPlan 返回结果（用于获取拼焊信息）
 * @param {Object} priceConfig - { carbonSteelPrice(W), stainlessSteelPrice(X), explosionPrice }
 * @param {Object} processPrices - 工序单价覆盖
 * @param {Object} options - { sellingPricePerTon(S), totalAmount(T), fixedCosts: {labor, depreciation, electricity} }
 * @returns {Object} 工序成本明细（包含Excel所有列）
 */
function calculateProcessCost(item, rawMaterial, layoutPlan, priceConfig, processPrices = {}, options = {}) {
  const { grade, sheets: P, isCircular } = item;
  const rm = rawMaterial;

  // ===== 从第一页获取采购尺寸 (排版后调整尺寸) =====
  // 优先使用 layoutPlan.adjustedDims (拼焊/倍尺后的实际采购尺寸)
  // 回退到 rawMaterial 基础尺寸
  const adj = (layoutPlan && layoutPlan.adjustedDims) ? layoutPlan.adjustedDims : null;
  const J = adj ? adj.basePurchaseWidth : rm.rawMaterial.basePurchaseWidth;       // 基层采购宽度(排版后)
  const L = adj ? adj.basePurchaseLength : rm.rawMaterial.basePurchaseLength;     // 基层采购长度(排版后)
  const K = adj ? adj.claddingPurchaseWidth : rm.rawMaterial.claddingPurchaseWidth;    // 复层采购宽度(排版后)
  const M = adj ? adj.claddingPurchaseLength : rm.rawMaterial.claddingPurchaseLength;  // 复层采购长度(排版后)
  const Pm = adj ? adj.materialCount : P;  // P' 材料数量(板数), 用于材料相关公式
  const H = rm.input.width;                          // 成品宽度
  const I = rm.input.length;                         // 成品长度

  // ===== 基础参数 =====
  const D = rm.input.claddingThickness;              // 复层厚度
  const F = rm.input.baseThickness;                  // 基层厚度
  const E = rm.input.purchaseCladdingThickness || D; // 采购复层厚度
  const G = rm.input.purchaseBaseThickness || F;     // 采购基层厚度
  const N = rm.material.claddingDensity;             // 复层密度
  const O = rm.material.baseDensity;                 // 基板密度
  const W_price = priceConfig.carbonSteelPrice || 0; // 碳钢单价(含税) W
  const X_price = priceConfig.stainlessSteelPrice || 0; // 不锈钢单价(含税) X

  // ===== 成品重量 Q (吨) =====
  const Q_unit = Math.round(D * H * I * N / 1e9 * 1000) / 1000
               + Math.round(O * F * H * I / 1e9 * 1000) / 1000;
  const R_total = Q_unit * P;  // 成品总重(吨) R

  // ===== 计算用基础数据 =====
  // AE: 成品面积 = H * I * P / 1e6 (m²)
  const AE = (isCircular ? Math.PI * (H/2) * (H/2) : H * I) * P / 1e6;

  // AF: 成品重量(吨) = (D*H*I*N/1e6 + F*H*I*O/1e6) * P / 1000
  const finishedArea_mm2 = isCircular ? Math.PI * (H/2) * (H/2) : H * I;
  const AF = (D * finishedArea_mm2 * N / 1e6 + F * finishedArea_mm2 * O / 1e6) * P / 1000;

  // AG: 投料重量(吨) = (E*N*K*L + J*L*O*G) / 1e6 * Pm / 1000
  // 注意：Excel公式中复层重量用K*L(复层采购宽×基层采购长)，基层用J*L
  // 使用排版后采购尺寸 + Pm(板数)
  const AG = (E * N * K * L / 1e6 + J * L * O * G / 1e6) * Pm / 1000;

  // AC: 覆层面积 = K * M / 1e6 * Pm (m²) — 用排版后尺寸+板数
  const AC = K * M / 1e6 * Pm;

  // AD: 基层面积 = J * L / 1e6 * Pm (m²) — 用排版后尺寸+板数
  const AD = J * L / 1e6 * Pm;

  // AB: 投料重量/㎡ = (E*N + G*O) / 1000 (吨/m²)
  const AB = (E * N + G * O) / 1000;

  // AA: 成品重量/㎡ = AF / AE
  const AA = AE > 0 ? AF / AE : 0;

  // ===== 爆炸单价 (查表) =====
  const explosionPrice = priceConfig.explosionPrice || getExplosionPrice(D, grade);

  // ===== 合并工序单价 =====
  const pp = {};
  for (const key in PROCESSING_FEES) {
    pp[key] = processPrices[key] ?? PROCESSING_FEES[key].price;
  }

  // ===== 拼焊焊缝信息 =====
  let weldLength_m = 0;
  let hasWelding = false;
  if (layoutPlan && layoutPlan.plans) {
    const weldPlan = layoutPlan.plans.find(p => p.type === 'welding');
    if (weldPlan && weldPlan.totalWeldLength) {
      weldLength_m = weldPlan.totalWeldLength / 1000 * Pm;  // 按板数计算
      hasWelding = true;
    }
  }

  // ===== 各工序成本 (按Excel公式) =====
  // AI: 拼焊成本 = AH(单价) * M(复层采购长-排版后) * 1.2 / 1000 * Pm(板数)
  const AI = hasWelding
    ? pp.welding * M * 1.2 / 1000 * Pm
    : 0;

  // AM: 打磨成本 = AJ(覆层单价)*AC + AK(基层单价)*AD + AL(成品单价)*AE
  const AM = pp.grindingClad * AC + pp.grindingBase * AD + pp.grindingFinish * AE;

  // AO: 爆炸成本 = AN(单价) * AC(覆层面积)
  const AO = explosionPrice * AC;

  // AQ: 倒转运输成本 = AP(单价) * AG(投料重量)
  const AQ = pp.transport * AG;

  // AS: 热处理成本 = AR(单价) * AG(投料重量)
  const AS = pp.heatTreat * AG;

  // AU: 校平成本 = AT(单价) * AB(投料重量/㎡) * AD(基层面积)
  const AU = pp.straighten * AB * AD;

  // AW: 切割成本 = AV(单价) * (H+I) * 2 * P / 1000
  const AW = pp.cutting * (H + I) * 2 * P / 1000;

  // AY: UT成本 = AX(单价) * AD(基层面积)
  const AY = pp.ut * AD;

  // BA: 包装成本 = AZ(单价) * AE(成品面积)
  const BA = pp.packaging * AE;

  // BC: 铣边成本 = (H+I) * 2 * P * BB(单价) / 1000
  const BC = (H + I) * 2 * P * pp.edgeMilling / 1000;

  // BE: PT成本 = BD(单价) * I(成品长度) * P / 1000
  const BE = pp.pt * I * P / 1000;

  // BG: 补焊成本 = BF(单价) * AF(成品重量)
  const BG = pp.repairWeld * AF;

  // ===== 汇总 =====
  // BH: 生产成本(不含税)不含固定 = (AI+AM+AO+AQ+AS+AU+AW+AY+BA+BC+BE+BG) / 1.13
  const BH = (AI + AM + AO + AQ + AS + AU + AW + AY + BA + BC + BE + BG) / 1.13;

  // BI: 总加工成本/㎡(不含税) = BH / AE
  const BI = AE > 0 ? BH / AE : 0;

  // BJ: 前后道加工成本/㎡(不含税) = BI - AO/AE/1.13 - AQ/AE/1.09
  const BJ = BI - (AE > 0 ? AO / AE / 1.13 : 0) - (AE > 0 ? AQ / AE / 1.09 : 0);

  // BL: 废钢(不含税) = -(AG - AF) * 0.9 * 2300
  const scrapWeight = AG - AF;
  const BL = -scrapWeight * 0.9 * DEFAULTS.scrapSteelPrice;

  // BK: 原材料成本(不含税) = (E*K*M*N*Pm*X + G*J*L*O*Pm*W) / 1e9 / 1.13 + BL
  // 使用排版后采购尺寸 + Pm(板数)
  const BK = (E * K * M * N * Pm * X_price + G * J * L * O * Pm * W_price) / 1e9 / 1.13 + BL;

  // BM: 总成本(不含税) = BH + BK
  const BM = BH + BK;

  // BN: 加工成本/吨 不含固定费用 = BH / (Q*P) = BH / R
  const BN = R_total > 0 ? BH / R_total : 0;

  // BO: 前后道加工成本/吨 = BJ / AB
  const BO = AB > 0 ? BJ / AB : 0;

  // BP: 吨成本 不含固定费用 = BK / R + BN
  const BP = (R_total > 0 ? BK / R_total : 0) + BN;

  // ===== 固定费用 =====
  const fc = options.fixedCosts || FIXED_COSTS;
  const BQ = fc.labor || 0;           // 人工
  const BR = fc.depreciation || 0;    // 折旧
  const BS = fc.electricity || 0;     // 电费

  // BT: 加工成本含固定费用/吨 = BN + BQ + BR + BS
  const BT = BN + BQ + BR + BS;

  // ===== 报价与毛利 =====
  // S: 单价(含税)元/吨 — 手动输入
  // T: 总金额(含税)元 — 手动输入
  const S_price = options.sellingPricePerTon || 0;
  const T_total = options.totalAmount || 0;

  let sellingPricePerTon = S_price;
  let totalAmount = T_total;

  // 如果只填了总金额，反算单价
  if (!S_price && T_total && R_total > 0) {
    sellingPricePerTon = T_total / R_total;
  }
  // 如果只填了单价，算总金额
  if (S_price && !T_total) {
    totalAmount = Math.round(S_price * R_total * 100) / 100;
  }

  // BU: 毛利(不含税)不含固定费用 = S/1.13 - BP
  const BU = sellingPricePerTon > 0 ? sellingPricePerTon / 1.13 - BP : 0;

  // BV: 毛利(不含税)含固定费用 = BU - BQ - BR - BS
  const BV = BU - BQ - BR - BS;

  // U: 毛利金额(元) = V(=BV) * R
  const U_profit = BV * R_total;

  // T: 总金额(含税) = ROUND(S * R, 2)
  const T_calculated = sellingPricePerTon > 0 ? Math.round(sellingPricePerTon * R_total * 100) / 100 : (totalAmount || 0);

  const hasPrice = sellingPricePerTon > 0 || totalAmount > 0;

  // ===== 组装工序明细数组（用于展示） =====
  const processes = [
    { key: 'welding',       name: '拼焊',     unit: '元',   price: pp.welding,       qty: hasWelding ? (M * 1.2 / 1000 * Pm) : 0,          cost: AI,   qtyDesc: hasWelding ? `复层采购长${M}mm×1.2×${Pm}板` : '无需拼焊' },
    { key: 'grindingClad',  name: '打磨-复板', unit: '元/㎡', price: pp.grindingClad,  qty: AC,    cost: pp.grindingClad * AC,   qtyDesc: `覆层面积${AC.toFixed(2)}㎡` },
    { key: 'grindingBase',  name: '打磨-基板', unit: '元/㎡', price: pp.grindingBase,  qty: AD,    cost: pp.grindingBase * AD,   qtyDesc: `基层面积${AD.toFixed(2)}㎡` },
    { key: 'grindingFinish',name: '打磨-成品', unit: '元/㎡', price: pp.grindingFinish,qty: AE,    cost: pp.grindingFinish * AE, qtyDesc: `成品面积${AE.toFixed(2)}㎡` },
    { key: 'explosion',     name: '爆炸',     unit: '元/㎡', price: explosionPrice,   qty: AC,    cost: AO,                      qtyDesc: `覆层面积${AC.toFixed(2)}㎡` },
    { key: 'transport',     name: '倒转运输',  unit: '元/吨', price: pp.transport,     qty: AG,    cost: AQ,                      qtyDesc: `投料${AG.toFixed(3)}吨` },
    { key: 'heatTreat',     name: '热处理',   unit: '元/吨', price: pp.heatTreat,     qty: AG,    cost: AS,                      qtyDesc: `投料${AG.toFixed(3)}吨` },
    { key: 'straighten',    name: '校平',     unit: '元/㎡', price: pp.straighten,    qty: AB*AD, cost: AU,                      qtyDesc: `投料/㎡${AB.toFixed(4)}×基层面积${AD.toFixed(2)}` },
    { key: 'cutting',       name: '切割',     unit: '元/m',  price: pp.cutting,       qty: (H+I)*2*P/1000, cost: AW,            qtyDesc: `周长${((H+I)*2*P/1000).toFixed(1)}m` },
    { key: 'ut',            name: 'UT',      unit: '元/㎡', price: pp.ut,            qty: AD,    cost: AY,                      qtyDesc: `基层面积${AD.toFixed(2)}㎡` },
    { key: 'packaging',     name: '包装',     unit: '元/㎡', price: pp.packaging,     qty: AE,    cost: BA,                      qtyDesc: `成品面积${AE.toFixed(2)}㎡` },
    { key: 'edgeMilling',   name: '铣边',     unit: '元/m',  price: pp.edgeMilling,   qty: (H+I)*2*P/1000, cost: BC,            qtyDesc: `周长${((H+I)*2*P/1000).toFixed(1)}m` },
    { key: 'pt',            name: 'PT',      unit: '元/m',  price: pp.pt,            qty: I*P/1000,       cost: BE,            qtyDesc: `成品长${(I*P/1000).toFixed(1)}m` },
    { key: 'repairWeld',    name: '补焊',     unit: '元/吨', price: pp.repairWeld,    qty: AF,    cost: BG,                      qtyDesc: `成品重量${AF.toFixed(3)}吨` },
  ];

  return {
    // 工序明细
    processes,
    processCostBeforeTax: BH,        // BH: 生产成本(不含税)不含固定

    // 基础数据
    baseData: {
      AA, AB, AC, AD, AE, AF, AG,
      claddingDensity: N,
      baseDensity: O,
    },

    // 采购尺寸（排版后实际采购尺寸）
    purchaseDims: { J, K, L, M, E, G },
    // 基础采购尺寸（排版前，用于对比）
    basePurchaseDims: {
      J: rm.rawMaterial.basePurchaseWidth,
      K: rm.rawMaterial.claddingPurchaseWidth,
      L: rm.rawMaterial.basePurchaseLength,
      M: rm.rawMaterial.claddingPurchaseLength,
    },
    // 排版调整信息
    layoutAdjustment: adj ? {
      adjusted: adj.adjusted,
      reason: adj.adjustmentReason,
      materialCount: Pm,
      originalSheets: P,
    } : null,

    // 成品参数
    finished: {
      D, F, H, I, P,
      Q_unit,        // 成品单重(吨)
      R_total,       // 成品总重(吨)
      isCircular,
    },

    // 成本汇总
    cost: {
      BH,             // 生产成本(不含税)不含固定
      BI,             // 总加工成本/㎡(不含税)
      BJ,             // 前后道加工成本/㎡(不含税)
      BK,             // 原材料成本(不含税)
      BL,             // 废钢(不含税，负值)
      BM,             // 总成本(不含税)
      BN,             // 加工成本/吨 不含固定
      BO,             // 前后道加工成本/吨
      BP,             // 吨成本 不含固定费用
      BT,             // 加工成本含固定费用/吨
    },

    // 固定费用
    fixedCosts: { BQ, BR, BS },

    // 报价与毛利
    pricing: {
      S: sellingPricePerTon,        // 单价(含税)元/吨
      T: T_calculated,              // 总金额(含税)元
      BU,                           // 毛利(不含税)不含固定费用
      BV,                           // 毛利(不含税)含固定费用
      U: U_profit,                  // 毛利金额(元)
      hasPrice,                     // 是否已填入价格
    },

    // 爆炸单价
    explosionPrice,

    // 废钢
    scrapWeight,
  };
}

// ========== 批量计算 ==========

/**
 * 批量计算多个规格的成本
 * @param {Array} items - 输入参数数组
 * @param {Object} commonParams - 公共参数 (价格等)
 * @returns {Array} 计算结果数组
 */
function calculateBatch(items, commonParams = {}) {
  return items.map(item => {
    const input = { ...commonParams, ...item };
    return calculateCost(input);
  });
}

// ========== 汇总统计 ==========

function summarizeResults(results) {
  return {
    totalSheets: results.reduce((sum, r) => sum + r.input.sheets, 0),
    totalArea: results.reduce((sum, r) => sum + r.area.totalFinishedArea, 0),
    totalWeight: results.reduce((sum, r) => sum + r.weight.finishedTotalWeight, 0),
    totalCost: results.reduce((sum, r) => sum + r.profit.totalCost, 0),
    totalRevenue: results.reduce((sum, r) => sum + r.profit.totalRevenue, 0),
    totalGrossProfit: results.reduce((sum, r) => sum + r.profit.totalGrossProfit, 0),
    avgGrossProfitPerTon: results.length > 0
      ? results.reduce((sum, r) => sum + r.profit.grossProfitPerTon * r.weight.finishedTotalWeight, 0) /
        results.reduce((sum, r) => sum + r.weight.finishedTotalWeight, 0)
      : 0,
  };
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.CostCalculator = {
    calculateCost,
    calculateBatch,
    summarizeResults,
    designRawMaterial,
    designLayoutPlan,
    designSharedLayout,
    generateWeldingDrawing,
    calculateProcessCost,
    getCladdingMaterial,
    getBaseMaterial,
    getCladdingDensity,
    getBaseDensity,
    getExplosionPrice,
    getDefaultMargins,
    getMarginsByStandard,
    checkPurchaseSize,
    lookupDensity,
    getDensitySearchUrl,
    lookupPriceReference,
    getPriceSearchUrl,
    calculateSuggestedPrice,
    CLADDING_DENSITY,
    BASE_DENSITY,
    EXPLOSION_PRICE_TABLE,
    MATERIAL_CATEGORY,
    STANDARD_STAINLESS_WIDTHS,
    MAX_PURCHASE_LENGTH,
    PROCESSING_FEES,
    FIXED_COSTS,
    DEFAULTS,
    STEEL_PRICE_REFERENCE,
  };
}
