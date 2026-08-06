/**
 * 爆炸成本核算系统 - 主应用逻辑
 */

// ========== 认证 ==========

const AUTH = {
  // 预设账号 (演示用)
  credentials: {
    '409884': { password: 'Zoe2002328', name: '管理员' },
    '007092': { password: 'Wjs895623!', name: '操作员' },
  },

  login(username, password) {
    const user = this.credentials[username];
    if (user && user.password === password) {
      const token = JSON.stringify({ username, name: user.name, ts: Date.now() });
      sessionStorage.setItem('auth_token', token);
      return { success: true, name: user.name };
    }
    return { success: false, error: '用户名或密码错误' };
  },

  logout() {
    sessionStorage.removeItem('auth_token');
    location.reload();
  },

  check() {
    const token = sessionStorage.getItem('auth_token');
    if (!token) return null;
    try {
      return JSON.parse(token);
    } catch {
      return null;
    }
  },
};

// ========== 应用状态 ==========

const App = {
  parsedItems: [],      // 从文件解析出的规格
  results: [],          // 计算结果
  priceConfig: {        // 价格参数
    carbonSteelPrice: 4900,
    stainlessSteelPrice: 28300,
    quotationPerTon: 14580,
    explosionPrice: null,  // null = 自动查表
  },
  designOptions: {      // 原材料设计选项
    sampling: false,    // 取样
    asmeSA264: false,   // ASME SA264标准
  },

  init() {
    this.bindEvents();
    const user = AUTH.check();
    if (!user) {
      this.showLogin();
    } else {
      this.showApp(user);
    }
  },

  showLogin() {
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('appPage').classList.add('hidden');
  },

  showApp(user) {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('appPage').classList.remove('hidden');
    document.getElementById('userName').textContent = user.name;
  },

  bindEvents() {
    // 登录表单
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const result = AUTH.login(username, password);
        if (result.success) {
          this.showApp({ username, name: result.name });
        } else {
          const errEl = document.getElementById('loginError');
          errEl.textContent = result.error;
          errEl.classList.add('show');
        }
      });
    }

    // 登出
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => AUTH.logout());
    }

    // 文件上传
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    if (uploadZone && fileInput) {
      uploadZone.addEventListener('click', () => fileInput.click());
      uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
      });
      uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
      });
      uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
          this.handleFile(e.dataTransfer.files[0]);
        }
      });
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
          this.handleFile(e.target.files[0]);
        }
      });
    }

    // 添加手动规格
    const addManualBtn = document.getElementById('addManualBtn');
    if (addManualBtn) {
      addManualBtn.addEventListener('click', () => this.addManualItem());
    }

    // 计算按钮
    const calcBtn = document.getElementById('calcBtn');
    if (calcBtn) {
      calcBtn.addEventListener('click', () => this.calculate());
    }

    // 加载示例数据
    const loadSampleBtn = document.getElementById('loadSampleBtn');
    if (loadSampleBtn) {
      loadSampleBtn.addEventListener('click', () => this.loadSampleData());
    }

    // 价格参数变化
    ['carbonSteelPrice', 'stainlessSteelPrice', 'quotationPerTon'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          this.priceConfig[id] = parseFloat(el.value) || 0;
        });
      }
    });

    // 爆炸单价覆盖
    const explosionEl = document.getElementById('explosionPrice');
    if (explosionEl) {
      explosionEl.addEventListener('input', () => {
        const val = explosionEl.value.trim();
        this.priceConfig.explosionPrice = val ? parseFloat(val) : null;
      });
    }

    // 取样勾选
    const samplingCb = document.getElementById('samplingCheckbox');
    if (samplingCb) {
      samplingCb.addEventListener('change', () => {
        this.designOptions.sampling = samplingCb.checked;
        this.renderRawMaterialDesign();
      });
    }

    // ASME SA264 勾选
    const asmeCb = document.getElementById('asmeCheckbox');
    if (asmeCb) {
      asmeCb.addEventListener('change', () => {
        this.designOptions.asmeSA264 = asmeCb.checked;
        this.renderRawMaterialDesign();
      });
    }
  },

  // ========== 文件处理 ==========

  async handleFile(file) {
    const statusEl = document.getElementById('uploadStatus');
    statusEl.innerHTML = '<span class="loading"></span> 正在解析文件...';
    statusEl.className = 'alert alert-info';

    try {
      const items = await DocParser.parse(file);

      if (items.length === 0) {
        statusEl.textContent = '未能从文件中提取到有效数据，请手动输入或检查文件格式';
        statusEl.className = 'alert alert-error';
        return;
      }

      this.parsedItems = items;
      statusEl.textContent = `成功解析 ${items.length} 条规格数据`;
      statusEl.className = 'alert alert-success';

      this.renderParsedItems();
    } catch (err) {
      statusEl.textContent = `解析失败: ${err.message}`;
      statusEl.className = 'alert alert-error';
      console.error(err);
    }
  },

  renderParsedItems() {
    const container = document.getElementById('parsedItems');
    if (this.parsedItems.length === 0) {
      container.innerHTML = '';
      this.renderRawMaterialDesign();
      return;
    }

    container.innerHTML = this.parsedItems.map((item, idx) => {
      const dimText = item.isCircular
        ? `<div class="item-field"><span class="label">直径:</span><span class="value">Ф${item.diameter || item.width}mm (圆形)</span></div>`
        : `<div class="item-field"><span class="label">宽度:</span><span class="value">${item.width}mm</span></div>
           <div class="item-field"><span class="label">长度:</span><span class="value">${item.length}mm</span></div>`;
      return `
      <div class="parsed-item">
        <div class="item-index">${idx + 1}</div>
        <div class="item-content">
          <div class="item-field"><span class="label">牌号:</span><span class="value">${item.grade}</span></div>
          <div class="item-field"><span class="label">复层厚度:</span><span class="value">${item.claddingThickness}mm</span></div>
          <div class="item-field"><span class="label">基层厚度:</span><span class="value">${item.baseThickness}mm</span></div>
          ${dimText}
          <div class="item-field"><span class="label">张数:</span><span class="value">${item.sheets}张</span></div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="App.removeItem(${idx})">删除</button>
      </div>
    `;}).join('');

    // 同时渲染原材料尺寸设计
    this.renderRawMaterialDesign();
  },

  // ========== 原材料尺寸设计 ==========

  renderRawMaterialDesign() {
    const card = document.getElementById('rawMaterialCard');
    const container = document.getElementById('rawMaterialDesign');

    if (this.parsedItems.length === 0) {
      card.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    card.style.display = '';

    container.innerHTML = this.parsedItems.map((item, idx) => {
      const design = CostCalculator.designRawMaterial({
        ...item,
        options: this.designOptions,
      });
      const shapeIcon = design.input.isCircular ? ' <span class="badge badge-blue">圆</span>' : '';
      const finishedDim = design.input.isCircular
        ? `Ф${design.input.diameter || design.input.width}mm`
        : `${design.input.width} × ${design.input.length}mm`;

      const warningHtml = (design.warnings && design.warnings.length > 0)
        ? `<div class="rm-warnings">${design.warnings.map(w => `<div class="rm-warning">⚠ ${w}</div>`).join('')}</div>`
        : '';
      const asmeBadge = design.margins.asmeExtra > 0
        ? ' <span class="badge badge-amber">ASME</span>' : '';

      return `
        <div class="rm-item">
          <div class="rm-header">
            <span class="rm-index">${idx + 1}</span>
            <span class="rm-grade"><strong>${design.input.grade}</strong>${shapeIcon}${asmeBadge}</span>
            <span class="rm-shape">${design.input.isCircular ? '圆形板' : '矩形板'}</span>
            <span class="text-sm text-secondary">${design.margins.marginSource}</span>
          </div>
          <div class="text-sm" style="margin-bottom:6px;color:var(--text-secondary);">放量条件: ${design.margins.conditionDesc} | 厚度公差: ${design.margins.thicknessTolerance}</div>

          <div class="rm-flow">
            <!-- 成品尺寸 -->
            <div class="rm-block rm-finished">
              <div class="rm-block-title">成品尺寸</div>
              <table class="rm-table">
                <tr><td>复层厚度</td><td>${design.input.claddingThickness} mm</td></tr>
                <tr><td>基层厚度</td><td>${design.input.baseThickness} mm</td></tr>
                <tr><td>总厚度</td><td>${design.input.totalThickness} mm</td></tr>
                <tr><td>${design.input.isCircular ? '直径' : '宽×长'}</td><td>${finishedDim}</td></tr>
                <tr><td>张数</td><td>${design.input.sheets} 张</td></tr>
              </table>
            </div>

            <div class="rm-arrow">→</div>

            <!-- 余量参数 -->
            <div class="rm-block rm-margin">
              <div class="rm-block-title">放量 (NB/T标准)</div>
              <table class="rm-table">
                <tr><td>基层加宽</td><td>+${design.margins.baseWidening} mm</td></tr>
                <tr><td>基层加长</td><td>+${design.margins.baseLengthening} mm</td></tr>
                <tr><td>覆层加宽</td><td>+${design.margins.claddingWidening} mm</td></tr>
                <tr><td>覆层加长</td><td>+${design.margins.claddingLengthening} mm</td></tr>
                ${design.margins.asmeExtra > 0 ? `<tr><td>ASME加厚</td><td>+${design.margins.asmeExtra} mm</td></tr>` : ''}
              </table>
            </div>

            <div class="rm-arrow">→</div>

            <!-- 原材料采购尺寸 -->
            <div class="rm-block rm-raw">
              <div class="rm-block-title">原材料(采购)尺寸</div>
              <table class="rm-table">
                <tr><td>基层宽×长</td><td><strong>${design.rawMaterial.basePurchaseWidth} × ${design.rawMaterial.basePurchaseLength} mm</strong></td></tr>
                <tr><td>基层厚度</td><td>${design.rawMaterial.basePurchaseThickness} mm</td></tr>
                <tr><td>复层宽×长</td><td><strong>${design.rawMaterial.claddingPurchaseWidth} × ${design.rawMaterial.claddingPurchaseLength} mm</strong></td></tr>
                <tr><td>复层厚度</td><td>${design.rawMaterial.claddingPurchaseThickness} mm</td></tr>
              </table>
            </div>
          </div>

          ${warningHtml}

          <!-- 面积与重量 -->
          <div class="rm-flow" style="margin-top: 4px;">
            <div class="rm-block rm-summary">
              <div class="rm-block-title">面积</div>
              <table class="rm-table">
                <tr><td>单板爆炸面积</td><td>${design.area.explosionAreaPerSheet.toFixed(2)} ㎡ ${design.input.isCircular ? '(矩形)' : ''}</td></tr>
                <tr><td>单板成品面积</td><td>${design.area.finishedAreaPerSheet.toFixed(2)} ㎡ ${design.input.isCircular ? '(πr²)' : ''}</td></tr>
                <tr><td>成品总面积</td><td><strong>${design.area.totalFinishedArea.toFixed(2)} ㎡</strong></td></tr>
              </table>
            </div>
            <div class="rm-block rm-summary">
              <div class="rm-block-title">重量(单板)</div>
              <table class="rm-table">
                <tr><td>采购基层单重</td><td>${design.weight.purchaseBaseWeight.toFixed(3)} 吨</td></tr>
                <tr><td>采购复层单重</td><td>${design.weight.purchaseCladdingWeight.toFixed(3)} 吨</td></tr>
                <tr><td>采购单重</td><td><strong>${design.weight.purchaseTotalWeight.toFixed(3)} 吨</strong></td></tr>
              </table>
            </div>
            <div class="rm-block rm-summary">
              <div class="rm-block-title">重量(成品)</div>
              <table class="rm-table">
                <tr><td>成品基层单重</td><td>${design.weight.finishedBaseWeight.toFixed(3)} 吨</td></tr>
                <tr><td>成品复层单重</td><td>${design.weight.finishedCladdingWeight.toFixed(3)} 吨</td></tr>
                <tr><td>成品单重</td><td><strong>${design.weight.finishedUnitWeight.toFixed(3)} 吨</strong></td></tr>
                <tr><td>成品总重</td><td><strong>${design.weight.finishedTotalWeight.toFixed(3)} 吨</strong></td></tr>
              </table>
            </div>
            <div class="rm-block rm-summary">
              <div class="rm-block-title">成材率</div>
              <table class="rm-table">
                <tr><td>基层成材率</td><td>${(design.yield.baseYield * 100).toFixed(1)}%</td></tr>
                <tr><td>复层成材率</td><td>${(design.yield.claddingYield * 100).toFixed(1)}%</td></tr>
                <tr><td>合计成材率</td><td><strong>${(design.yield.totalYield * 100).toFixed(1)}%</strong></td></tr>
              </table>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  removeItem(idx) {
    this.parsedItems.splice(idx, 1);
    this.renderParsedItems();
  },

  loadSampleData() {
    // 从Excel金0804和万物生化0801加载示例数据
    this.parsedItems = [
      { grade: 'S31603+Q235B', claddingThickness: 3, baseThickness: 9, width: 1600, length: 6000, sheets: 7 },
      { grade: 'S31603+Q345R', claddingThickness: 3, baseThickness: 14, width: 1600, length: 6000, sheets: 11 },
      { grade: 'TA2+Q235B', claddingThickness: 3, baseThickness: 14, width: 1520, length: 5360, sheets: 4 },
      { grade: 'TA2+Q345R', claddingThickness: 3, baseThickness: 12, width: 1740, length: 5170, sheets: 36 },
    ];

    // 更新价格参数
    document.getElementById('carbonSteelPrice').value = 4900;
    document.getElementById('stainlessSteelPrice').value = 28300;
    document.getElementById('quotationPerTon').value = 14580;
    this.priceConfig.carbonSteelPrice = 4900;
    this.priceConfig.stainlessSteelPrice = 28300;
    this.priceConfig.quotationPerTon = 14580;

    this.renderParsedItems();

    const statusEl = document.getElementById('uploadStatus');
    statusEl.textContent = '已加载 ' + this.parsedItems.length + ' 条示例规格数据';
    statusEl.className = 'alert alert-success';
  },

  addManualItem() {
    const grade = document.getElementById('manualGrade').value.trim();
    const cladding = parseFloat(document.getElementById('manualCladding').value);
    const base = parseFloat(document.getElementById('manualBase').value);
    const width = parseFloat(document.getElementById('manualWidth').value);
    const length = parseFloat(document.getElementById('manualLength').value);
    const sheets = parseInt(document.getElementById('manualSheets').value) || 1;

    if (!grade || !cladding || !base || !width || !length) {
      alert('请填写完整的规格参数');
      return;
    }

    this.parsedItems.push({
      grade,
      claddingThickness: cladding,
      baseThickness: base,
      width,
      length,
      sheets,
    });

    this.renderParsedItems();

    // 清空输入框
    document.getElementById('manualGrade').value = '';
    document.getElementById('manualCladding').value = '';
    document.getElementById('manualBase').value = '';
    document.getElementById('manualWidth').value = '';
    document.getElementById('manualLength').value = '';
    document.getElementById('manualSheets').value = '1';
  },

  // ========== 计算 ==========

  calculate() {
    if (this.parsedItems.length === 0) {
      alert('请先上传生产通知单或手动添加规格');
      return;
    }

    this.results = this.parsedItems.map(item => {
      return CostCalculator.calculateCost({
        ...item,
        options: this.designOptions,
        carbonSteelPrice: this.priceConfig.carbonSteelPrice,
        stainlessSteelPrice: this.priceConfig.stainlessSteelPrice,
        quotationPerTon: this.priceConfig.quotationPerTon,
        explosionPrice: this.priceConfig.explosionPrice || undefined,
      });
    });

    this.renderResults();
  },

  // ========== 结果展示 ==========

  renderResults() {
    const resultSection = document.getElementById('resultSection');
    resultSection.classList.remove('hidden');

    // 汇总统计
    const summary = CostCalculator.summarizeResults(this.results);
    document.getElementById('summarySheets').textContent = summary.totalSheets;
    document.getElementById('summaryArea').textContent = summary.totalArea.toFixed(1);
    document.getElementById('summaryWeight').textContent = summary.totalWeight.toFixed(2);
    document.getElementById('summaryCost').textContent = summary.totalCost.toFixed(0);
    document.getElementById('summaryRevenue').textContent = summary.totalRevenue.toFixed(0);
    document.getElementById('summaryProfit').textContent = summary.totalGrossProfit.toFixed(0);

    // 毛利颜色
    const profitCard = document.getElementById('summaryProfitCard');
    if (summary.totalGrossProfit >= 0) {
      profitCard.className = 'stat-card profit';
    } else {
      profitCard.className = 'stat-card loss';
    }

    // 明细表格
    this.renderResultTable();

    // 滚动到结果
    resultSection.scrollIntoView({ behavior: 'smooth' });
  },

  renderResultTable() {
    const tbody = document.getElementById('resultTableBody');
    tbody.innerHTML = this.results.map((r, idx) => {
      const profitClass = r.profit.grossProfitPerTon >= 0 ? 'badge-green' : 'badge-red';
      const profitText = r.profit.grossProfitPerTon >= 0 ? '盈利' : '亏损';
      const shapeIcon = r.input.isCircular ? ' <span class="badge badge-blue">圆</span>' : '';
      const dimText = r.input.isCircular
        ? `Ф${r.input.width}`
        : `${r.input.width}×${r.input.length}`;
      return `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${r.input.grade}</strong>${shapeIcon}</td>
          <td class="num">${r.input.claddingThickness}</td>
          <td class="num">${r.input.baseThickness}</td>
          <td class="num" colspan="2">${dimText}</td>
          <td class="num">${r.input.sheets}</td>
          <td class="num">${r.weight.finishedUnitWeight.toFixed(3)}</td>
          <td class="num">${r.weight.finishedTotalWeight.toFixed(3)}</td>
          <td class="num">${r.area.totalFinishedArea.toFixed(2)}</td>
          <td class="num">${r.material.explosionPrice}</td>
          <td class="num">${r.cost.materialCostPerTon.toFixed(0)}</td>
          <td class="num">${r.cost.explosionCostPerTon.toFixed(0)}</td>
          <td class="num">${r.cost.totalCostPerTon.toFixed(0)}</td>
          <td class="num"><strong>${r.profit.quotationPerTon.toLocaleString()}</strong></td>
          <td class="num ${r.profit.grossProfitPerTon >= 0 ? '' : 'text-danger'}" style="${r.profit.grossProfitPerTon < 0 ? 'color: var(--danger)' : ''}">
            ${r.profit.grossProfitPerTon.toFixed(0)}
          </td>
          <td class="num ${r.profit.totalGrossProfit >= 0 ? '' : 'text-danger'}" style="${r.profit.totalGrossProfit < 0 ? 'color: var(--danger)' : ''}">
            ${r.profit.totalGrossProfit.toFixed(0)}
          </td>
          <td><span class="badge ${profitClass}">${profitText}</span></td>
          <td class="action-cell">
            <button class="btn btn-sm" onclick="App.showDetail(${idx})">详情</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  showDetail(idx) {
    const r = this.results[idx];
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');

    content.innerHTML = `
      <div class="detail-section">
        <div class="detail-title">基本信息</div>
        <table class="data-table">
          <tr><td>牌号</td><td>${r.input.grade}</td></tr>
          <tr><td>形状</td><td>${r.input.isCircular ? '圆形板' : '矩形板'}</td></tr>
          <tr><td>复层材料</td><td>${r.input.claddingMaterial}</td></tr>
          <tr><td>基层材料</td><td>${r.input.baseMaterial}</td></tr>
          <tr><td>总厚度</td><td>${r.input.totalThickness} mm</td></tr>
          <tr><td>复层厚度 / 采购厚度</td><td>${r.input.claddingThickness} / ${r.input.purchaseCladdingThickness} mm</td></tr>
          <tr><td>基层厚度 / 采购厚度</td><td>${r.input.baseThickness} / ${r.input.purchaseBaseThickness} mm</td></tr>
          <tr><td>${r.input.isCircular ? '直径' : '宽度 × 长度'}</td><td>${r.input.isCircular ? 'Ф' + r.input.width + ' mm' : r.input.width + ' × ' + r.input.length + ' mm'}</td></tr>
          <tr><td>张数</td><td>${r.input.sheets} 张</td></tr>
        </table>
      </div>

      <div class="detail-section">
        <div class="detail-title">尺寸参数</div>
        <table class="data-table">
          <tr><td>放量标准</td><td>${r.dimensions.marginSource || '-'}</td></tr>
          <tr><td>放量条件</td><td>${r.dimensions.conditionDesc || '-'}</td></tr>
          <tr><td>厚度公差</td><td>${r.dimensions.thicknessTolerance || '-'}</td></tr>
          <tr><td>基层加宽 / 覆层加宽</td><td>${r.dimensions.baseWidening} / ${r.dimensions.claddingWidening} mm</td></tr>
          <tr><td>基层加长 / 覆层加长</td><td>${r.dimensions.baseLengthening} / ${r.dimensions.claddingLengthening} mm</td></tr>
          ${r.dimensions.asmeExtra > 0 ? `<tr><td>ASME加厚</td><td>+${r.dimensions.asmeExtra} mm</td></tr>` : ''}
          <tr><td>基层采购宽度 x 长度</td><td>${r.dimensions.basePurchaseWidth} x ${r.dimensions.basePurchaseLength} mm</td></tr>
          <tr><td>覆层采购宽度 x 长度</td><td>${r.dimensions.claddingPurchaseWidth} x ${r.dimensions.claddingPurchaseLength} mm</td></tr>
        </table>
      </div>

      <div class="detail-section">
        <div class="detail-title">面积与重量</div>
        <table class="data-table">
          <tr><td>单板爆炸面积</td><td>${r.area.explosionAreaPerSheet.toFixed(3)} ㎡ ${r.input.isCircular ? '(矩形采购面)' : ''}</td></tr>
          <tr><td>单板成品面积</td><td>${r.area.finishedAreaPerSheet.toFixed(3)} ㎡ ${r.input.isCircular ? '(π·r²)' : ''}</td></tr>
          <tr><td>成品总面积</td><td>${r.area.totalFinishedArea.toFixed(3)} ㎡</td></tr>
          <tr><td>采购基层单重</td><td>${r.weight.purchaseBaseWeight.toFixed(3)} 吨</td></tr>
          <tr><td>采购复层单重</td><td>${r.weight.purchaseCladdingWeight.toFixed(3)} 吨</td></tr>
          <tr><td>成品单重</td><td>${r.weight.finishedUnitWeight.toFixed(3)} 吨</td></tr>
          <tr><td>成品总重</td><td>${r.weight.finishedTotalWeight.toFixed(3)} 吨</td></tr>
        </table>
      </div>

      <div class="detail-section">
        <div class="detail-title">成本分析</div>
        <table class="data-table">
          <tr><td>复层密度</td><td>${r.material.claddingDensity} g/cm³</td></tr>
          <tr><td>爆炸单价</td><td>${r.material.explosionPrice} 元/㎡</td></tr>
          <tr><td>碳钢单价</td><td>${r.input.carbonSteelPrice.toLocaleString()} 元/吨</td></tr>
          <tr><td>不锈钢单价</td><td>${r.input.stainlessSteelPrice.toLocaleString()} 元/吨</td></tr>
          <tr><td>单板材料成本</td><td>${r.cost.materialCostPerSheet.toFixed(2)} 元</td></tr>
          <tr><td>吨钢材料成本</td><td>${r.cost.materialCostPerTon.toFixed(2)} 元/吨</td></tr>
          <tr><td>爆炸吨钢成本</td><td>${r.cost.explosionCostPerTon.toFixed(2)} 元/吨</td></tr>
          <tr><td>前后道加工成本</td><td>${r.cost.processingCostPerTon.toFixed(0)} 元/吨</td></tr>
          <tr><td>合格率</td><td>${(r.cost.passRate * 100).toFixed(0)}%</td></tr>
          <tr><td><strong>吨钢总成本</strong></td><td><strong>${r.cost.totalCostPerTon.toFixed(2)} 元/吨</strong></td></tr>
        </table>
      </div>

      <div class="detail-section">
        <div class="detail-title">成材率</div>
        <table class="data-table">
          <tr><td>基层成材率</td><td>${(r.yield.baseYield * 100).toFixed(1)}%</td></tr>
          <tr><td>复层成材率</td><td>${(r.yield.claddingYield * 100).toFixed(1)}%</td></tr>
          <tr><td>合计成材率</td><td>${(r.yield.totalYield * 100).toFixed(1)}%</td></tr>
        </table>
      </div>

      <div class="detail-section">
        <div class="detail-title">报价与毛利</div>
        <table class="data-table">
          <tr><td>吨钢报价</td><td>${r.profit.quotationPerTon.toLocaleString()} 元/吨</td></tr>
          <tr><td>不含税报价</td><td>${(r.profit.quotationPerTon / 1.13).toFixed(0)} 元/吨</td></tr>
          <tr><td>单位面积报价</td><td>${r.profit.quotationPerSqm.toFixed(2)} 元/㎡</td></tr>
          <tr><td>毛利(吨钢)</td><td style="color: ${r.profit.grossProfitPerTon >= 0 ? 'var(--success)' : 'var(--danger)'}; font-weight: 700">
            ${r.profit.grossProfitPerTon.toFixed(2)} 元/吨
          </td></tr>
          <tr><td>毛利小计</td><td style="color: ${r.profit.totalGrossProfit >= 0 ? 'var(--success)' : 'var(--danger)'}; font-weight: 700">
            ${r.profit.totalGrossProfit.toFixed(2)} 元
          </td></tr>
          <tr><td>来料加工吨钢价格</td><td>${r.profit.processingPricePerTon.toFixed(2)} 元/吨</td></tr>
          <tr><td>来料加工报价</td><td>${r.profit.processingPricePerSqm.toFixed(2)} 元/㎡</td></tr>
        </table>
      </div>
    `;

    modal.classList.remove('hidden');
  },

  closeDetail() {
    document.getElementById('detailModal').classList.add('hidden');
  },
};

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', () => App.init());
