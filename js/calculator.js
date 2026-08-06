/**
 * 爆炸复合板成本核算引擎
 * 基于爆炸毛利表-成本0804.xlsx的公式逻辑
 */

// ========== 材料数据库 ==========

// 复层材料密度 (g/cm³)
const CLADDING_DENSITY = {
  // 不锈钢 (标准牌号)
  'S31603': 8.0, 'S31608': 8.0, 'S30403': 8.0, 'S30408': 8.0,
  'S31008': 8.0, 'S39042': 8.0, 'S31703': 8.0,
  // 不锈钢 (常用别名)
  '304': 8.0, '304L': 8.0, '316': 8.0, '316L': 8.0,
  '321': 8.0, '310S': 8.0, '309S': 8.0, '316TI': 8.0,
  // 双相不锈钢
  'S32205': 7.8, 'S32750': 7.8, 'S32101': 7.8,
  '2205': 7.8, '2507': 7.8, '2304': 7.8,
  // 钛及钛合金
  'TA1': 4.51, 'TA2': 4.51, 'TA9': 4.51, 'TA10': 4.51,
  // 镍基合金
  'N06625': 8.44, 'N08825': 8.14, 'N06600': 8.47,
  // 铜合金
  'TU1': 8.9, 'T2': 8.9, 'H62': 8.43, 'B10': 8.9, 'B30': 8.9,
};

// 基层材料密度
const BASE_DENSITY = {
  'Q235B': 7.85, 'Q235C': 7.85, 'Q345R': 7.85, 'Q245R': 7.85,
  'Q345B': 7.85, 'Q355B': 7.85, 'Q370R': 7.85,
  '20R': 7.85, '16MnR': 7.85,
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
  grinding:    { name: '打磨', price: 25,    unit: '㎡' },     // 打磨(成品)
  transport:   { name: '运输', price: 170,   unit: '吨' },     // 倒转运输
  heatTreat:   { name: '热处理', price: 80,  unit: '吨' },     // 热处理
  straighten:  { name: '校平', price: 7,     unit: '㎡' },     // 校平
  ut:          { name: 'UT',   price: 1.5,   unit: '㎡' },     // 超声波检测
  packaging:   { name: '包装', price: 5,     unit: '㎡' },     // 包装
  cutting:     { name: '切割', price: 2.5,   unit: 'm'  },     // 切割
  edgeMilling: { name: '铣边', price: 2.2,   unit: 'm'  },     // 铣边
  pt:          { name: 'PT',   price: 12,    unit: 'm'  },     // 渗透检测
  repairWeld:  { name: '补焊', price: 30,    unit: '块' },     // 补焊
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
      baseL += 150; cladL += 150;
      notes.push('取样+150mm');
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

  // 不锈钢/双相钢: 按 NB/T 47002.1-2019 查表
  // 确定复层厚度分组
  let group;
  if (claddingThickness <= 2) group = 1;
  else if (claddingThickness <= 7) group = 2;
  else group = 3;

  const groupDesc = group === 1 ? '复层≤2mm' : group === 2 ? '复层3~7mm' : '复层8~10mm';
  const thickTol = group === 1 ? '≥-0.1mm' : group === 2 ? '≥-0.15mm' : '≥-0.3mm';

  let baseWidening, baseLengthening;
  let conditionDesc = '';

  // 查表: 基层余量取决于成品宽度、成品长度
  if (group === 1 || group === 2) {
    if (width >= 2600) {
      baseWidening = 50;
      baseLengthening = Math.round(length * 0.01);
      conditionDesc = `宽≥2600: 基层+50/+1%`;
    } else if (length > 5000) {
      baseWidening = 40;
      baseLengthening = Math.round(length * 0.01);
      conditionDesc = `宽≤2600, 长>5000: 基层+40/+1%`;
    } else {
      baseWidening = 40;
      baseLengthening = 40;
      conditionDesc = `宽≤2600, 长≤5000: 基层+40/+40`;
    }
  } else {
    // group 3 (8~10mm)
    if (width >= 2600 || length > 5000) {
      baseWidening = 50;
      baseLengthening = Math.round(length * 0.01);
      conditionDesc = `宽≥2600或长>5000: 基层+50/+1%`;
    } else {
      baseWidening = 50;
      baseLengthening = 50;
      conditionDesc = `宽≤2600, 长≤5000: 基层+50/+50`;
    }
  }

  // 覆层余量: 固定 +30/+30
  let claddingWidening = 30;
  let claddingLengthening = 30;
  let notes = [`覆层+30/+30`, conditionDesc];

  // 取样: 额外+150mm
  if (options.sampling) {
    baseLengthening += 150;
    claddingLengthening += 150;
    notes.push('取样+150mm');
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
    marginSource: `NB/T 47002.1-2019 ${groupDesc}`,
    conditionDesc: notes.join('，'),
    thicknessTolerance: thickTol,
    group,
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

  // 密度
  const R = getCladdingDensity(grade);
  const baseDensity = getBaseDensity(grade);
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
  const explosionArea_mm2 = K * O;                    // 爆炸面积(采购矩形) mm²
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
  const T = K * O / 1000000;          // 单板爆炸面积 ㎡ (采购尺寸, 始终矩形)
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

  return {
    input: design.input,
    rawMaterial: design.rawMaterial,
    margins: design.margins,
    plans,
    warnings: design.warnings,
  };
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
    generateWeldingDrawing,
    getCladdingMaterial,
    getBaseMaterial,
    getCladdingDensity,
    getExplosionPrice,
    getDefaultMargins,
    getMarginsByStandard,
    checkPurchaseSize,
    CLADDING_DENSITY,
    BASE_DENSITY,
    EXPLOSION_PRICE_TABLE,
    MATERIAL_CATEGORY,
    STANDARD_STAINLESS_WIDTHS,
    MAX_PURCHASE_LENGTH,
    PROCESSING_FEES,
    DEFAULTS,
  };
}
