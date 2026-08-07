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
  processResults: [],   // 工序成本计算结果
  currentTab: 'tab1',   // 当前Tab
  priceConfig: {        // 价格参数（无默认值，需手动填入）
    carbonSteelPrice: 0,
    stainlessSteelPrice: 0,
    explosionPrice: null,  // null = 自动查表
  },
  orderPrices: {},      // 每条订单的报价 { idx: { sellingPricePerTon, totalAmount } }
  fixedCosts: {         // 固定费用
    labor: 970,
    depreciation: 700,
    electricity: 338,
  },
  processPrices: {},    // 工序单价覆盖（空=用默认值）
  designOptions: {      // 原材料设计选项
    keyOrder: false,    // 重点订单
    sampling: false,    // 取样
    asmeSA264: false,   // ASME SA264标准
    sharedLayout: true, // 同订单内同复层牌号、厚度的条带统一分配
  },
  densityOverrides: {},  // 密度手动覆盖 { idx: { cladding: x, base: y } }
  targetMarginRate: 0.15, // 建议售价目标利润率

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
    // 初始化第二页表格
    this.renderExplosionPriceTable();
    this.renderProcessPriceTable();
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

    // 圆形板勾选联动
    const manualCircular = document.getElementById('manualCircular');
    if (manualCircular) {
      manualCircular.addEventListener('change', () => {
        const isCircular = manualCircular.checked;
        const widthLabel = document.getElementById('manualWidthLabel');
        const lengthGroup = document.getElementById('manualLengthGroup');
        const widthInput = document.getElementById('manualWidth');
        if (isCircular) {
          widthLabel.textContent = '直径 (mm)';
          widthInput.placeholder = '如 Ф1850';
          lengthGroup.style.display = 'none';
        } else {
          widthLabel.textContent = '宽度 (mm)';
          widthInput.placeholder = '如 1600';
          lengthGroup.style.display = '';
        }
      });
    }

    // 加载示例数据
    const loadSampleBtn = document.getElementById('loadSampleBtn');
    if (loadSampleBtn) {
      loadSampleBtn.addEventListener('click', () => this.loadSampleData());
    }

    // 价格参数变化
    ['carbonSteelPrice', 'stainlessSteelPrice'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          this.priceConfig[id] = parseFloat(el.value) || 0;
          this.renderProcessCost();
        });
      }
    });

    // 固定费用
    ['fixedLabor', 'fixedDepreciation', 'fixedElectricity'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const key = id.replace('fixed', '').toLowerCase();
        el.addEventListener('input', () => {
          this.fixedCosts[key] = parseFloat(el.value) || 0;
          this.renderProcessCost();
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

    // 获取碳钢最新报价
    const fetchCarbonBtn = document.getElementById('fetchCarbonPriceBtn');
    if (fetchCarbonBtn) {
      fetchCarbonBtn.addEventListener('click', () => this.fetchSteelPrice('carbon'));
    }

    // 获取不锈钢最新报价
    const fetchStainlessBtn = document.getElementById('fetchStainlessPriceBtn');
    if (fetchStainlessBtn) {
      fetchStainlessBtn.addEventListener('click', () => this.fetchSteelPrice('stainless'));
    }

    // 目标利润率
    const marginEl = document.getElementById('targetMarginRate');
    if (marginEl) {
      marginEl.addEventListener('input', () => {
        this.targetMarginRate = (parseFloat(marginEl.value) || 15) / 100;
        this.renderProcessCost();
      });
    }

    // 批量建议报价
    const suggestAllBtn = document.getElementById('suggestAllPriceBtn');
    if (suggestAllBtn) {
      suggestAllBtn.addEventListener('click', () => this.applyAllSuggestedPrices());
    }

    // 重点订单勾选
    const keyOrderCb = document.getElementById('keyOrderCheckbox');
    if (keyOrderCb) {
      keyOrderCb.addEventListener('change', () => {
        this.designOptions.keyOrder = keyOrderCb.checked;
        this.renderRawMaterialDesign();
        this.renderLayoutPlan();
        this.renderProcessCost();
      });
    }

    // 取样勾选
    const samplingCb = document.getElementById('samplingCheckbox');
    if (samplingCb) {
      samplingCb.addEventListener('change', () => {
        this.designOptions.sampling = samplingCb.checked;
        this.renderRawMaterialDesign();
        this.renderLayoutPlan();
        this.renderProcessCost();
      });
    }

    // ASME SA264 勾选
    const asmeCb = document.getElementById('asmeCheckbox');
    if (asmeCb) {
      asmeCb.addEventListener('change', () => {
        this.designOptions.asmeSA264 = asmeCb.checked;
        this.renderRawMaterialDesign();
        this.renderLayoutPlan();
        this.renderProcessCost();
      });
    }

    // 同订单跨产品共版拼焊
    const sharedLayoutCb = document.getElementById('sharedLayoutCheckbox');
    if (sharedLayoutCb) {
      sharedLayoutCb.checked = this.designOptions.sharedLayout;
      sharedLayoutCb.addEventListener('change', () => {
        this.designOptions.sharedLayout = sharedLayoutCb.checked;
        this.renderRawMaterialDesign();
        this.renderLayoutPlan();
        this.renderProcessCost();
      });
    }

    // Tab 切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });
  },

  switchTab(tabId) {
    this.currentTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('active', c.id === tabId);
    });
    // 切换到成本核算页时刷新工序成本
    if (tabId === 'tab2') {
      this.renderProcessCost();
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
      this.renderLayoutPlan();
      return;
    }

    container.innerHTML = this.parsedItems.map((item, idx) => {
      const dimText = item.isCircular
        ? `<div class="item-field">
             <span class="label">直径:</span>
             <input type="number" class="inline-input" value="${item.diameter || item.width}" step="1" min="1"
               onchange="App.updateDimension(${idx}, this.value)" style="width:70px;">mm <span class="badge badge-blue">圆</span>
           </div>`
        : `<div class="item-field">
             <span class="label">宽度:</span>
             <input type="number" class="inline-input" value="${item.width}" step="1" min="1"
               onchange="App.updateThickness(${idx}, 'width', this.value)" style="width:70px;">mm
           </div>
           <div class="item-field">
             <span class="label">长度:</span>
             <input type="number" class="inline-input" value="${item.length}" step="1" min="1"
               onchange="App.updateThickness(${idx}, 'length', this.value)" style="width:70px;">mm
           </div>`;
      return `
      <div class="parsed-item">
        <div class="item-index">${idx + 1}</div>
        <div class="item-content">
          <div class="item-field"><span class="label">牌号:</span><span class="value">${item.grade}</span></div>
          <div class="item-field">
            <span class="label">复层厚度:</span>
            <input type="number" class="inline-input" value="${item.claddingThickness}" step="0.1" min="0.5"
              onchange="App.updateThickness(${idx}, 'claddingThickness', this.value)" style="width:60px;">mm
          </div>
          <div class="item-field">
            <span class="label">基层厚度:</span>
            <input type="number" class="inline-input" value="${item.baseThickness}" step="0.5" min="1"
              onchange="App.updateThickness(${idx}, 'baseThickness', this.value)" style="width:60px;">mm
          </div>
          ${dimText}
          <div class="item-field">
            <span class="label">张数:</span>
            <input type="number" class="inline-input" value="${item.sheets}" min="1"
              onchange="App.updateThickness(${idx}, 'sheets', this.value)" style="width:50px;">张
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="App.removeItem(${idx})">删除</button>
      </div>
    `;}).join('');

    // 同时渲染原材料尺寸设计和拼焊方案
    this.renderRawMaterialDesign();
    this.renderLayoutPlan();
    // 同步更新第二页工序成本
    this.renderProcessCost();
  },

  // ========== 原材料尺寸设计 ==========

  getLayoutBundle() {
    const inputs = this.parsedItems.map(item => ({ ...item, options: this.designOptions }));
    if (this.designOptions.sharedLayout && inputs.length > 1) {
      return CostCalculator.designSharedLayout(inputs);
    }
    return {
      layoutByIndex: inputs.map(input => CostCalculator.designLayoutPlan(input)),
      groups: [],
    };
  },

  renderSharedLayoutSummary(groups) {
    if (!groups || groups.length === 0) return '';
    const weldingGroups = groups.filter(g => g.type !== 'multiblank');
    const mbGroups = groups.filter(g => g.type === 'multiblank');
    let html = '<div class="shared-layout-summary">';

    if (weldingGroups.length > 0) {
      html += '<div class="shared-layout-title">同订单共版拼焊汇总</div>';
      weldingGroups.forEach(group => {
        html += `
          <div class="shared-layout-group">
            <div><span class="badge badge-red">共版拼焊</span> <strong>${group.claddingMaterial} ${group.claddingThickness}mm</strong> · 产品第${group.productIndexes.map(i => i + 1).join('、')}项</div>
            <table class="rm-table">
              <tr><td>统一标准条带宽</td><td><strong>${group.standardWidth} mm</strong></td></tr>
              <tr><td>合计条带需求</td><td>${group.totalStripDemand} 条</td></tr>
              <tr><td>实际需求面积</td><td>${group.totalDemandArea.toFixed(2)} ㎡</td></tr>
              <tr><td>按标准宽采购面积</td><td>${group.totalPurchaseArea.toFixed(2)} ㎡</td></tr>
              <tr><td>统一分配余料</td><td>${group.wasteArea.toFixed(2)} ㎡</td></tr>
            </table>
          </div>`;
      });
    }

    if (mbGroups.length > 0) {
      html += '<div class="shared-layout-title" style="margin-top:12px;">同订单共版倍尺汇总</div>';
      mbGroups.forEach(group => {
        html += `
          <div class="shared-layout-group">
            <div><span class="badge badge-amber">共版倍尺</span> <strong>${group.baseMaterial} ${group.baseThickness}mm</strong> · 成品宽${group.finishedWidth}mm · 产品第${group.productIndexes.map(i => i + 1).join('、')}项</div>
            <table class="rm-table">
              <tr><td>每板排列</td><td><strong>${group.perPlate} 件/板</strong></td></tr>
              <tr><td>共需基板</td><td><strong>${group.platesNeeded} 板</strong> <span style="color:var(--text-tertiary);font-size:11px;">(独立需${group.individualPlates}板)</span></td></tr>
              <tr><td>节省板数</td><td><strong style="color:var(--success)">节省 ${group.savings} 板</strong></td></tr>
              <tr><td>排列方案</td><td style="font-size:11px;">${group.arrangement.join('；')}</td></tr>
            </table>
          </div>`;
      });
    }

    html += '</div>';
    return html;
  },

  renderRawMaterialDesign() {
    const card = document.getElementById('rawMaterialCard');
    const container = document.getElementById('rawMaterialDesign');

    if (this.parsedItems.length === 0) {
      card.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    card.style.display = '';
    const layoutBundle = this.getLayoutBundle();

    container.innerHTML = this.renderSharedLayoutSummary(layoutBundle.groups) + this.parsedItems.map((item, idx) => {
      const design = CostCalculator.designRawMaterial({
        ...item,
        options: this.designOptions,
      });
      const layout = layoutBundle.layoutByIndex[idx];
      const adj = layout.adjustedDims;
      const hasAdj = adj && adj.adjusted;
      const shapeIcon = design.input.isCircular ? ' <span class="badge badge-blue">圆</span>' : '';
      const finishedDim = design.input.isCircular
        ? `Ф${design.input.diameter || design.input.width}mm`
        : `${design.input.width} × ${design.input.length}mm`;

      const warningHtml = (design.warnings && design.warnings.length > 0)
        ? `<div class="rm-warnings">${design.warnings.map(w => `<div class="rm-warning">⚠ ${w}</div>`).join('')}</div>`
        : '';
      const asmeBadge = design.margins.asmeExtra > 0
        ? ' <span class="badge badge-amber">ASME</span>' : '';

      // 采购尺寸展示: 排版后有调整时显示对比
      const baseW = design.rawMaterial.basePurchaseWidth;
      const baseL = design.rawMaterial.basePurchaseLength;
      const cladW = design.rawMaterial.claddingPurchaseWidth;
      const cladL = design.rawMaterial.claddingPurchaseLength;
      const adjBaseW = hasAdj ? adj.basePurchaseWidth : baseW;
      const adjBaseL = hasAdj ? adj.basePurchaseLength : baseL;
      const adjCladW = hasAdj ? adj.claddingPurchaseWidth : cladW;
      const adjCladL = hasAdj ? adj.claddingPurchaseLength : cladL;
      const baseChanged = hasAdj && (adjBaseW !== baseW || adjBaseL !== baseL);
      const cladChanged = hasAdj && (adjCladW !== cladW || adjCladL !== cladL);
      const countChanged = hasAdj && adj.materialCount !== design.input.sheets;

      const adjBadge = hasAdj ? ' <span class="badge badge-amber">排版调整</span>' : '';
      const adjNoteHtml = hasAdj ? `
        <div class="alert alert-warning" style="margin-top:6px;padding:6px 10px;font-size:12px;">
          <strong>排版后调整:</strong> ${adj.adjustmentReason}
          ${countChanged ? `<br>材料数量: ${design.input.sheets}张 → ${adj.materialCount}板` : ''}
        </div>` : '';

      const baseDimHtml = baseChanged
        ? `<span style="text-decoration:line-through;color:var(--text-tertiary);font-size:11px;">${baseW} × ${baseL}mm</span><br><strong>${adjBaseW} × ${adjBaseL} mm</strong>`
        : `<strong>${baseW} × ${baseL} mm</strong>`;
      const cladDimHtml = cladChanged
        ? `<span style="text-decoration:line-through;color:var(--text-tertiary);font-size:11px;">${cladW} × ${cladL}mm</span><br><strong>${adjCladW} × ${adjCladL} mm</strong>`
        : `<strong>${cladW} × ${cladL} mm</strong>`;

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

            <!-- 原材料采购尺寸 (排版后) -->
            <div class="rm-block rm-raw">
              <div class="rm-block-title">原材料(采购)尺寸${adjBadge}</div>
              <table class="rm-table">
                <tr><td>基层宽×长</td><td>${baseDimHtml}</td></tr>
                <tr><td>基层厚度</td><td>${design.rawMaterial.basePurchaseThickness} mm</td></tr>
                <tr><td>复层宽×长</td><td>${cladDimHtml}</td></tr>
                <tr><td>复层厚度</td><td>${design.rawMaterial.claddingPurchaseThickness} mm</td></tr>
                ${countChanged ? `<tr><td>材料数量</td><td><strong>${adj.materialCount} 板</strong> <span style="color:var(--text-tertiary);font-size:11px;">(原${design.input.sheets}张)</span></td></tr>` : ''}
              </table>
            </div>
          </div>

          ${warningHtml}
          ${adjNoteHtml}

          <!-- 面积与重量 -->
          <div class="rm-flow" style="margin-top: 4px;">
            <div class="rm-block rm-summary">
              <div class="rm-block-title">面积</div>
              <table class="rm-table">
                <tr><td>单板爆炸面积</td><td>${design.area.explosionAreaPerSheet.toFixed(2)} ㎡ ${design.input.isCircular ? '(矩形)' : ''}</td></tr>
                <tr><td>单板成品面积</td><td>${design.area.finishedAreaPerSheet.toFixed(2)} ㎡ ${design.input.isCircular ? '(πr²)' : ''}</td></tr>
                <tr><td>成品总面积</td><td><strong>${design.area.totalFinishedArea.toFixed(2)} ㎡</strong></td></tr>
                ${hasAdj ? `<tr><td>爆炸面积(排版后)</td><td><strong style="color:var(--warning);">${(adjCladW * adjCladL * adj.materialCount / 1e6).toFixed(2)} ㎡</strong></td></tr>` : ''}
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

  updateThickness(idx, field, value) {
    const v = parseFloat(value);
    if (isNaN(v) || v <= 0) return;
    this.parsedItems[idx][field] = field === 'sheets' ? Math.round(v) : v;
    // 圆形板：改宽度时同步直径
    if (field === 'width' && this.parsedItems[idx].isCircular && this.parsedItems[idx].diameter !== undefined) {
      this.parsedItems[idx].diameter = v;
    }
    this.renderRawMaterialDesign();
    this.renderLayoutPlan();
    this.renderProcessCost();
  },

  // 圆形板直径修改：同时更新 diameter 和 width
  updateDimension(idx, value) {
    const v = parseFloat(value);
    if (isNaN(v) || v <= 0) return;
    this.parsedItems[idx].width = v;
    this.parsedItems[idx].diameter = v;
    this.renderRawMaterialDesign();
    this.renderLayoutPlan();
    this.renderProcessCost();
  },

  // ========== 拼焊/倍尺方案设计 ==========

  renderLayoutPlan() {
    const card = document.getElementById('layoutPlanCard');
    const container = document.getElementById('layoutPlanDesign');

    if (this.parsedItems.length === 0) {
      card.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    card.style.display = '';
    const layoutBundle = this.getLayoutBundle();

    container.innerHTML = this.renderSharedLayoutSummary(layoutBundle.groups) + this.parsedItems.map((item, idx) => {
      const planResult = layoutBundle.layoutByIndex[idx];

      const plansHtml = planResult.plans.map((plan, pIdx) => {
        const drawing = CostCalculator.generateWeldingDrawing(plan, planResult.rawMaterial, planResult.input);
        let detailHtml = '';

        if (plan.type === 'welding') {
          detailHtml = `
            <div class="lp-detail">
              <table class="rm-table">
                <tr><td>条带数</td><td>${plan.stripCount} 条</td></tr>
                <tr><td>各条带宽度</td><td>${plan.strips.map(s => s.actualWidth + 'mm').join(' + ')}</td></tr>
                <tr><td>标准板宽</td><td>${plan.strips[0].standardWidth}mm</td></tr>
                <tr><td>焊缝数量</td><td>${plan.stripCount - 1} 条</td></tr>
                <tr><td>焊缝位置</td><td>${plan.weldPositions.map(p => p + 'mm').join(', ')}</td></tr>
                <tr><td>焊缝总长</td><td><strong>${plan.weldLength_m} m</strong></td></tr>
                <tr><td>拼焊费用</td><td><strong>${plan.weldCost} 元</strong> (按${plan.weldPricePerM}元/m)</td></tr>
                <tr><td>废料宽度</td><td>${plan.wasteWidth}mm (${plan.wasteArea.toFixed(2)}㎡)</td></tr>
              </table>
            </div>`;
        } else if (plan.type === 'multiblank' && plan.best) {
          const optsHtml = plan.allOptions ? plan.allOptions.map((opt, i) => 
            `<tr><td>${opt.arrangement}</td><td>${opt.perPlate}张/板</td><td>${opt.platesNeeded}板</td><td>${opt.plateWidth}×${opt.plateLength}mm</td><td>${opt.savingArea}㎡</td><td>${opt.savingRate}%</td>${i === 0 ? '<td><span class="badge badge-green">推荐</span></td>' : '<td></td>'}</tr>`
          ).join('') : '';
          detailHtml = `
            <div class="lp-detail">
              <table class="rm-table">
                <tr><td>推荐排列</td><td><strong>${plan.best.arrangement}</strong> (${plan.best.cols}列×${plan.best.rows}行)</td></tr>
                <tr><td>每板排列</td><td>${plan.best.perPlate} 张/板</td></tr>
                <tr><td>需基板数</td><td>${plan.best.platesNeeded} 块</td></tr>
                <tr><td>基板尺寸</td><td>${plan.best.plateWidth} × ${plan.best.plateLength} mm</td></tr>
                <tr><td>节省面积</td><td><strong style="color:var(--success)">${plan.best.savingArea} ㎡</strong></td></tr>
                <tr><td>节省率</td><td><strong style="color:var(--success)">${plan.best.savingRate}%</strong></td></tr>
                <tr><td>切割次数</td><td>${plan.best.cutCount} 次</td></tr>
              </table>
              ${plan.allOptions && plan.allOptions.length > 1 ? `
                <div class="text-sm text-secondary" style="margin-top:8px;">其他方案对比:</div>
                <table class="data-table" style="margin-top:4px;font-size:11px;">
                  <thead><tr><th>排列</th><th>每板</th><th>板数</th><th>基板尺寸</th><th>节省</th><th>节省率</th><th></th></tr></thead>
                  <tbody>${optsHtml}</tbody>
                </table>
              ` : ''}
            </div>`;
        } else {
          detailHtml = `<div class="alert alert-success" style="margin:0;">采购尺寸符合标准，无需拼焊或倍尺。</div>`;
        }

        const badgeClass = plan.type === 'welding' ? 'badge-red' : plan.type === 'multiblank' ? 'badge-amber' : 'badge-green';
        const badgeText = plan.type === 'welding' ? '拼焊' : plan.type === 'multiblank' ? '倍尺' : '标准';

        return `
          <div class="lp-plan">
            <div class="lp-plan-header">
              <span class="badge ${badgeClass}">${badgeText}</span>
              <span class="lp-plan-title">${plan.title}</span>
              <span class="text-sm text-secondary">${plan.reason}</span>
            </div>
            ${detailHtml}
            ${drawing ? `<div class="lp-drawing" id="drawing_${idx}_${pIdx}">${drawing}<div style="margin-top:8px;"><button class="btn btn-sm" onclick="App.downloadDrawing(${idx}, ${pIdx})">下载图纸 (SVG)</button></div></div>` : ''}
          </div>
        `;
      }).join('');

      const shapeIcon = planResult.input.isCircular ? ' <span class="badge badge-blue">圆</span>' : '';

      return `
        <div class="lp-item">
          <div class="lp-header">
            <span class="rm-index">${idx + 1}</span>
            <span class="rm-grade"><strong>${planResult.input.grade}</strong>${shapeIcon}</span>
            <span class="text-sm text-secondary">覆层采购: ${planResult.rawMaterial.claddingPurchaseWidth}×${planResult.rawMaterial.claddingPurchaseLength}mm</span>
          </div>
          ${plansHtml}
        </div>
      `;
    }).join('');
  },

  downloadDrawing(itemIdx, planIdx) {
    const container = document.getElementById('drawing_' + itemIdx + '_' + planIdx);
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `拼焊图纸_${itemIdx + 1}_${planIdx + 1}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  loadSampleData() {
    this.parsedItems = [
      { grade: 'S31603+Q235B', claddingThickness: 3, baseThickness: 9, width: 1600, length: 6000, sheets: 7 },
      { grade: 'S31603+Q345R', claddingThickness: 3, baseThickness: 14, width: 1600, length: 6000, sheets: 11 },
      { grade: 'TA2+Q235B', claddingThickness: 3, baseThickness: 14, width: 1520, length: 5360, sheets: 4 },
      { grade: 'TA2+Q345R', claddingThickness: 3, baseThickness: 12, width: 1740, length: 5170, sheets: 36 },
    ];

    this.renderParsedItems();

    const statusEl = document.getElementById('uploadStatus');
    statusEl.textContent = '已加载 ' + this.parsedItems.length + ' 条示例规格数据';
    statusEl.className = 'alert alert-success';
  },

  addManualItem() {
    const grade = document.getElementById('manualGrade').value.trim();
    const cladding = parseFloat(document.getElementById('manualCladding').value);
    const base = parseFloat(document.getElementById('manualBase').value);
    const isCircular = document.getElementById('manualCircular').checked;
    const width = parseFloat(document.getElementById('manualWidth').value);
    const length = isCircular ? width : parseFloat(document.getElementById('manualLength').value);
    const sheets = parseInt(document.getElementById('manualSheets').value) || 1;

    if (!grade || !cladding || !base || !width || (!isCircular && !length)) {
      alert('请填写完整的规格参数');
      return;
    }

    this.parsedItems.push({
      grade,
      claddingThickness: cladding,
      baseThickness: base,
      width,
      length: isCircular ? width : length,
      sheets,
      isCircular,
      diameter: isCircular ? width : null,
    });

    this.renderParsedItems();

    // 清空输入框
    document.getElementById('manualGrade').value = '';
    document.getElementById('manualCladding').value = '';
    document.getElementById('manualBase').value = '';
    document.getElementById('manualWidth').value = '';
    document.getElementById('manualLength').value = '';
    document.getElementById('manualSheets').value = '1';
    document.getElementById('manualCircular').checked = false;
    document.getElementById('manualWidthLabel').textContent = '宽度 (mm)';
    document.getElementById('manualWidth').placeholder = '如 1600';
    document.getElementById('manualLengthGroup').style.display = '';
  },

  // ========== 计算 ==========

  calculate() {
    if (this.parsedItems.length === 0) {
      alert('请先在第一页上传生产通知单或手动添加规格');
      return;
    }
    this.renderProcessCost();
  },

  // ========== 结果展示 ==========

  renderResults() {
    const resultSection = document.getElementById('resultSection');
    resultSection.classList.remove('hidden');

    const results = this.processResults;
    let totalWeight = 0, totalCost = 0, totalRevenue = 0, totalProfit = 0, totalSheets = 0;

    results.forEach(pr => {
      totalSheets += pr.item.sheets || 0;
      totalWeight += pr.cost.finished.R_total;
      totalCost += pr.cost.cost.BM;
      if (pr.cost.pricing.hasPrice) {
        totalRevenue += pr.cost.pricing.T;
        totalProfit += pr.cost.pricing.U;
      }
    });

    document.getElementById('summarySheets').textContent = totalSheets;
    document.getElementById('summaryWeight').textContent = totalWeight.toFixed(2);
    document.getElementById('summaryCost').textContent = totalCost.toFixed(0);
    document.getElementById('summaryRevenue').textContent = totalRevenue.toFixed(0);
    document.getElementById('summaryProfit').textContent = totalProfit.toFixed(0);

    const profitCard = document.getElementById('summaryProfitCard');
    if (totalProfit >= 0) {
      profitCard.className = 'stat-card profit';
    } else {
      profitCard.className = 'stat-card loss';
    }
  },

  showDetail(idx) {
    const pr = this.processResults[idx];
    if (!pr) return;
    const c = pr.cost;
    const item = pr.item;
    const rm = pr.rawMaterial;

    const content = document.getElementById('detailContent');
    const shapeIcon = item.isCircular ? ' <span class="badge badge-blue">圆</span>' : '';
    const dimText = item.isCircular ? `Ф${item.width}mm` : `${item.width}×${item.length}mm`;

    content.innerHTML = `
      <div class="detail-section">
        <div class="detail-title">基本信息</div>
        <table class="data-table">
          <tr><td>牌号</td><td><strong>${item.grade}</strong>${shapeIcon}</td></tr>
          <tr><td>复层/基层厚度</td><td>${item.claddingThickness} / ${item.baseThickness} mm</td></tr>
          <tr><td>尺寸</td><td>${dimText}</td></tr>
          <tr><td>张数</td><td>${item.sheets} 张</td></tr>
          <tr><td>复层密度 / 基板密度</td><td>${c.baseData.claddingDensity} / ${c.baseData.baseDensity} g/cm³</td></tr>
        </table>
      </div>
      <div class="detail-section">
        <div class="detail-title">原材料规格（排版后实际采购尺寸）</div>
        <table class="data-table">
          <tr><td>基层采购 宽×长</td><td>${c.purchaseDims.J} × ${c.purchaseDims.L} mm${(c.basePurchaseDims && c.basePurchaseDims.J !== c.purchaseDims.J) ? `<br><span style="text-decoration:line-through;color:var(--text-tertiary);font-size:11px;">原: ${c.basePurchaseDims.J} × ${c.basePurchaseDims.L}mm</span>` : ''}</td></tr>
          <tr><td>复层采购 宽×长</td><td>${c.purchaseDims.K} × ${c.purchaseDims.M} mm${(c.basePurchaseDims && c.basePurchaseDims.K !== c.purchaseDims.K) ? `<br><span style="text-decoration:line-through;color:var(--text-tertiary);font-size:11px;">原: ${c.basePurchaseDims.K} × ${c.basePurchaseDims.M}mm</span>` : ''}</td></tr>
          <tr><td>采购复层厚 / 采购基层厚</td><td>${c.purchaseDims.E} / ${c.purchaseDims.G} mm</td></tr>
          ${(c.layoutAdjustment && c.layoutAdjustment.adjusted) ? `<tr><td>排版调整</td><td style="font-size:11px;color:var(--text-secondary);">${c.layoutAdjustment.reason}${c.layoutAdjustment.materialCount !== c.layoutAdjustment.originalSheets ? `<br>材料数量: ${c.layoutAdjustment.materialCount}板 (原${c.layoutAdjustment.originalSheets}张)` : ''}</td></tr>` : ''}
        </table>
      </div>
      <div class="detail-section">
        <div class="detail-title">基础数据</div>
        <table class="data-table">
          <tr><td>成品单重 / 总重</td><td>${c.finished.Q_unit.toFixed(3)} / ${c.finished.R_total.toFixed(3)} 吨</td></tr>
          <tr><td>成品面积 AE</td><td>${c.baseData.AE.toFixed(2)} ㎡</td></tr>
          <tr><td>覆层面积 AC</td><td>${c.baseData.AC.toFixed(2)} ㎡</td></tr>
          <tr><td>基层面积 AD</td><td>${c.baseData.AD.toFixed(2)} ㎡</td></tr>
          <tr><td>投料重量 AG</td><td>${c.baseData.AG.toFixed(3)} 吨</td></tr>
          <tr><td>成品重量 AF</td><td>${c.baseData.AF.toFixed(3)} 吨</td></tr>
          <tr><td>废钢重量</td><td>${c.scrapWeight.toFixed(3)} 吨</td></tr>
        </table>
      </div>
      <div class="detail-section">
        <div class="detail-title">成本汇总</div>
        <table class="data-table">
          <tr><td>生产成本(不含税)不含固定 BH</td><td>${c.cost.BH.toFixed(2)} 元</td></tr>
          <tr><td>原材料成本(不含税) BK</td><td>${c.cost.BK.toFixed(2)} 元</td></tr>
          <tr><td>废钢(不含税) BL</td><td>${c.cost.BL.toFixed(2)} 元</td></tr>
          <tr><td><strong>总成本(不含税) BM</strong></td><td><strong>${c.cost.BM.toFixed(2)} 元</strong></td></tr>
          <tr><td>加工成本/吨 不含固定 BN</td><td>${c.cost.BN.toFixed(2)} 元/吨</td></tr>
          <tr><td>吨成本 不含固定 BP</td><td>${c.cost.BP.toFixed(2)} 元/吨</td></tr>
          <tr><td>加工成本含固定/吨 BT</td><td>${c.cost.BT.toFixed(2)} 元/吨</td></tr>
        </table>
      </div>
      <div class="detail-section">
        <div class="detail-title">报价与毛利</div>
        <table class="data-table">
          <tr><td>单价(含税)</td><td>${c.pricing.hasPrice ? c.pricing.S.toFixed(2) + ' 元/吨' : '<span class="text-danger">未填入</span>'}</td></tr>
          <tr><td>总金额(含税)</td><td>${c.pricing.hasPrice ? c.pricing.T.toFixed(2) + ' 元' : '<span class="text-danger">未填入</span>'}</td></tr>
          <tr><td>毛利(不含税)不含固定 BU</td><td style="color:${c.pricing.BU>=0?'var(--success)':'var(--danger)'}">${c.pricing.BU.toFixed(2)} 元/吨</td></tr>
          <tr><td>毛利(不含税)含固定 BV</td><td style="color:${c.pricing.BV>=0?'var(--success)':'var(--danger)'}">${c.pricing.BV.toFixed(2)} 元/吨</td></tr>
          <tr><td><strong>毛利金额 U</strong></td><td style="color:${c.pricing.U>=0?'var(--success)':'var(--danger)'};font-weight:700">${c.pricing.U.toFixed(2)} 元</td></tr>
        </table>
      </div>
    `;

    document.getElementById('detailModal').classList.remove('hidden');
  },

  closeDetail() {
    document.getElementById('detailModal').classList.add('hidden');
  },

  // ========== 第二页：价格表与工序成本 ==========

  renderExplosionPriceTable() {
    const container = document.getElementById('explosionPriceTable');
    if (!container) return;

    const table = CostCalculator.EXPLOSION_PRICE_TABLE;
    const thicknesses = Object.keys(table).map(Number).sort((a, b) => a - b);
    const categories = [
      { key: 'austenitic', name: '奥氏体不锈钢' },
      { key: 'duplex', name: '双相不锈钢' },
      { key: 'titanium', name: '钛及钛合金' },
      { key: 'nickel', name: '镍基合金&铜合金' },
    ];

    let html = '<table class="data-table explosion-table"><thead><tr><th>复层厚度 (mm)</th>';
    categories.forEach(c => html += `<th>${c.name}</th>`);
    html += '</tr></thead><tbody>';
    thicknesses.forEach(t => {
      html += `<tr><td class="num"><strong>${t}</strong></td>`;
      categories.forEach(c => {
        const val = table[t][c.key];
        html += `<td class="num">${val}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '<div class="text-sm text-secondary" style="margin-top:8px;">爆炸单价默认根据复层厚度和材料类型从此表查取（支持线性插值），也可在上方手动指定。</div>';
    container.innerHTML = html;
  },

  renderProcessPriceTable() {
    const container = document.getElementById('processPriceTable');
    if (!container) return;

    const fees = CostCalculator.PROCESSING_FEES;
    const keys = Object.keys(fees);

    let html = '<table class="data-table process-price-table"><thead><tr><th>工序</th><th>单价</th><th>单位</th></tr></thead><tbody>';
    keys.forEach(key => {
      const f = fees[key];
      const customVal = this.processPrices[key];
      const val = customVal ?? f.price;
      html += `<tr>
        <td>${f.name}</td>
        <td class="num">
          <input type="number" class="inline-input process-price-input" data-key="${key}" value="${val}" step="0.1" min="0" style="width:80px;" onchange="App.updateProcessPrice('${key}', this.value)">
        </td>
        <td>${f.unit}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  },

  updateProcessPrice(key, value) {
    const v = parseFloat(value);
    if (!isNaN(v) && v >= 0) {
      this.processPrices[key] = v;
    } else {
      delete this.processPrices[key];
    }
    this.renderProcessCost();
  },

  renderProcessCost() {
    const card = document.getElementById('processCostCard');
    const container = document.getElementById('processCostDetail');

    if (this.parsedItems.length === 0) {
      card.style.display = 'none';
      container.innerHTML = '';
      document.getElementById('resultSection').classList.add('hidden');
      return;
    }

    card.style.display = '';

    // 同步价格参数
    ['carbonSteelPrice', 'stainlessSteelPrice'].forEach(id => {
      const el = document.getElementById(id);
      if (el) this.priceConfig[id] = parseFloat(el.value) || 0;
    });
    const explosionEl = document.getElementById('explosionPrice');
    if (explosionEl) {
      const val = explosionEl.value.trim();
      this.priceConfig.explosionPrice = val ? parseFloat(val) : null;
    }

    // 同订单内相同复层牌号、厚度的拼焊条带统一分配
    const layoutBundle = this.getLayoutBundle();

    // 为每条订单计算工序成本
    this.processResults = this.parsedItems.map((item, idx) => {
      const claddingDensity = this.getDensity(idx, 'cladding');
      const baseDensity = this.getDensity(idx, 'base');
      const rawMaterial = CostCalculator.designRawMaterial({
        ...item, options: this.designOptions,
        claddingDensityOverride: claddingDensity,
        baseDensityOverride: baseDensity,
      });
      const layoutPlan = layoutBundle.layoutByIndex[idx];
      const orderPrice = this.orderPrices[idx] || {};
      const cost = CostCalculator.calculateProcessCost(
        item, rawMaterial, layoutPlan, this.priceConfig, this.processPrices,
        {
          sellingPricePerTon: orderPrice.sellingPricePerTon || 0,
          totalAmount: orderPrice.totalAmount || 0,
          fixedCosts: this.fixedCosts,
        }
      );
      return { item, rawMaterial, layoutPlan, cost };
    });

    container.innerHTML = this.processResults.map((pr, idx) => {
      const c = pr.cost;
      const item = pr.item;
      const shapeIcon = item.isCircular ? ' <span class="badge badge-blue">圆</span>' : '';
      const dimText = item.isCircular
        ? `Ф${item.width}mm`
        : `${item.width}×${item.length}mm`;
      const pd = c.purchaseDims;
      const bd = c.baseData;
      const fin = c.finished;
      const pricing = c.pricing;

      // 密度值
      const cladDensity = this.getDensity(idx, 'cladding');
      const baseDensityVal = this.getDensity(idx, 'base');
      const cladMat = CostCalculator.getCladdingMaterial(item.grade);
      const baseMat = CostCalculator.getBaseMaterial(item.grade);

      // 工序明细行
      let processRows = c.processes.map(p => `
        <tr>
          <td>${p.name}</td>
          <td class="num">${p.price.toFixed(1)}</td>
          <td>${p.unit}</td>
          <td class="num">${p.qty.toFixed(2)}</td>
          <td class="num">${p.cost.toFixed(2)}</td>
          <td class="text-secondary text-sm">${p.qtyDesc}</td>
        </tr>
      `).join('');

      // 建议售价
      const suggestion = this.getSuggestedPrice(idx);
      const suggestHtml = suggestion && suggestion.suggestedPricePerTon > 0 ? `
        <div class="pc-suggest">
          <span class="badge badge-blue">建议报价</span>
          <span class="text-sm">含税单价: <strong>${suggestion.suggestedPricePerTon} 元/吨</strong></span>
          <span class="text-sm text-secondary">| 总额: ${suggestion.suggestedTotalAmount} 元</span>
          <span class="text-sm text-secondary">| 吨成本: ${suggestion.costPerTon} 元/吨</span>
          <span class="text-sm" style="color:var(--success)">| 预估毛利: ${suggestion.marginPerTon} 元/吨</span>
          <button class="btn btn-sm btn-primary" onclick="App.applySuggestedPrice(${idx})" style="margin-left:8px;">填入建议价</button>
        </div>
      ` : '';

      // 报价输入
      const orderPrice = this.orderPrices[idx] || {};
      const priceInputHtml = `
        <div class="pc-price-input">
          <div class="form-group" style="margin:0;">
            <label class="text-sm">报价(含税) 元/吨</label>
            <input type="number" class="inline-input" value="${orderPrice.sellingPricePerTon || ''}" step="10" min="0"
              placeholder="手动填入" style="width:120px;"
              onchange="App.updateOrderPrice(${idx}, 'sellingPricePerTon', this.value)">
          </div>
          <div class="form-group" style="margin:0;">
            <label class="text-sm">总金额(含税) 元</label>
            <input type="number" class="inline-input" value="${orderPrice.totalAmount || ''}" step="100" min="0"
              placeholder="手动填入" style="width:140px;"
              onchange="App.updateOrderPrice(${idx}, 'totalAmount', this.value)">
          </div>
          <div class="form-group" style="margin:0;">
            <label class="text-sm">成品总重</label>
            <div class="text-sm" style="padding:6px 0;">${fin.R_total.toFixed(3)} 吨</div>
          </div>
        </div>
      `;

      const profitColor = pricing.BV >= 0 ? 'var(--success)' : 'var(--danger)';
      const noPriceHtml = pricing.hasPrice ? '' : '<div class="alert alert-warning" style="margin:8px 0;padding:6px 12px;font-size:12px;">⚠ 尚未填入报价，毛利无法计算。可点击"填入建议价"自动填入系统推荐价格。</div>';

      // 排版调整信息
      const la = c.layoutAdjustment;
      const laHtml = (la && la.adjusted) ? `
        <div class="alert alert-warning" style="margin:4px 0;padding:4px 10px;font-size:11px;">
          <strong>排版后采购尺寸:</strong> ${la.reason}
        </div>` : '';
      const laBadge = (la && la.adjusted) ? ' <span class="badge badge-amber">排版后</span>' : '';
      const countInfo = (la && la.materialCount !== la.originalSheets) ? ` | ${la.materialCount}板` : '';

      return `
        <div class="pc-item">
          <div class="pc-header">
            <span class="pc-index">${idx + 1}</span>
            <span class="pc-grade"><strong>${item.grade}</strong>${shapeIcon}</span>
            <span class="text-sm text-secondary">${dimText} | ${item.claddingThickness}+${item.baseThickness}mm | ${item.sheets}张${countInfo}</span>
            <span class="badge badge-blue">爆炸${c.explosionPrice}元/㎡</span>
          </div>

          ${laHtml}

          <!-- 原材料规格（排版后实际采购尺寸）+ 密度编辑 -->
          <div class="pc-specs">
            <span class="text-sm text-secondary">原材料规格${laBadge}:</span>
            <span class="badge badge-green">基层 ${pd.J}×${pd.L}mm</span>
            <span class="badge badge-green">复层 ${pd.K}×${pd.M}mm</span>
            <span class="badge badge-green">采购厚 ${pd.E}+${pd.G}mm</span>
            <span class="text-sm text-secondary">|</span>
            <span class="text-sm">复层密度:</span>
            <input type="number" class="inline-input density-input" value="${cladDensity}" step="0.01" min="0"
              style="width:60px;" title="复层材料 ${cladMat} 密度"
              onchange="App.updateDensity(${idx}, 'cladding', this.value)">
            <button class="btn btn-sm" onclick="App.searchDensityOnline('${cladMat}')" title="在线查询${cladMat}密度" style="padding:2px 6px;font-size:11px;">🔍</button>
            <span class="text-sm">基层密度:</span>
            <input type="number" class="inline-input density-input" value="${baseDensityVal}" step="0.01" min="0"
              style="width:60px;" title="基层材料 ${baseMat} 密度"
              onchange="App.updateDensity(${idx}, 'base', this.value)">
            <button class="btn btn-sm" onclick="App.searchDensityOnline('${baseMat}')" title="在线查询${baseMat}密度" style="padding:2px 6px;font-size:11px;">🔍</button>
            <span class="text-sm text-secondary">g/cm³</span>
          </div>

          <!-- 基础数据 -->
          <div class="pc-basedata">
            <table class="rm-table" style="font-size:11px;">
              <tr><td>成品单重</td><td>${fin.Q_unit.toFixed(3)}吨</td>
                  <td>成品总重</td><td><strong>${fin.R_total.toFixed(3)}吨</strong></td>
                  <td>成品面积</td><td>${bd.AE.toFixed(2)}㎡</td></tr>
              <tr><td>覆层面积</td><td>${bd.AC.toFixed(2)}㎡</td>
                  <td>基层面积</td><td>${bd.AD.toFixed(2)}㎡</td>
                  <td>投料重量</td><td>${bd.AG.toFixed(3)}吨</td></tr>
              <tr><td>成品重量</td><td>${bd.AF.toFixed(3)}吨</td>
                  <td>废钢</td><td>${c.scrapWeight.toFixed(3)}吨</td>
                  <td>投料/㎡</td><td>${bd.AB.toFixed(4)}吨/㎡</td></tr>
            </table>
          </div>

          <!-- 工序明细表 -->
          <div style="overflow-x:auto;">
            <table class="data-table pc-table">
              <thead>
                <tr>
                  <th>工序</th>
                  <th>单价</th>
                  <th>单位</th>
                  <th>数量</th>
                  <th>成本(元)</th>
                  <th>计算说明</th>
                </tr>
              </thead>
              <tbody>
                ${processRows}
                <tr class="pc-subtotal">
                  <td colspan="4"><strong>生产成本(不含税)不含固定 BH</strong></td>
                  <td class="num"><strong>${c.cost.BH.toFixed(2)}</strong></td>
                  <td class="text-secondary text-sm">∑工序/1.13</td>
                </tr>
                <tr class="pc-subtotal">
                  <td colspan="4">原材料成本(不含税) BK</td>
                  <td class="num">${c.cost.BK.toFixed(2)}</td>
                  <td class="text-secondary text-sm">碳钢${this.priceConfig.carbonSteelPrice||'未填'} + 不锈钢${this.priceConfig.stainlessSteelPrice||'未填'} + 废钢${c.cost.BL.toFixed(0)}</td>
                </tr>
                <tr class="pc-total">
                  <td colspan="4"><strong>总成本(不含税) BM</strong></td>
                  <td class="num"><strong>${c.cost.BM.toFixed(2)}</strong></td>
                  <td></td>
                </tr>
                <tr class="pc-subtotal">
                  <td colspan="4">吨成本(不含固定) BP</td>
                  <td class="num">${c.cost.BP.toFixed(0)} 元/吨</td>
                  <td class="text-secondary text-sm">加工${c.cost.BN.toFixed(0)} + 材料${(fin.R_total>0?(c.cost.BK/fin.R_total):0).toFixed(0)}</td>
                </tr>
                <tr class="pc-subtotal">
                  <td colspan="4">加工成本含固定/吨 BT</td>
                  <td class="num">${c.cost.BT.toFixed(0)} 元/吨</td>
                  <td class="text-secondary text-sm">+人工${this.fixedCosts.labor}+折旧${this.fixedCosts.depreciation}+电费${this.fixedCosts.electricity}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 建议售价 -->
          ${suggestHtml}

          <!-- 报价与毛利 -->
          ${priceInputHtml}
          ${noPriceHtml}
          ${pricing.hasPrice ? `
            <div class="pc-profit-result">
              <table class="rm-table" style="font-size:12px;">
                <tr>
                  <td>单价(含税)</td><td><strong>${pricing.S.toFixed(2)} 元/吨</strong></td>
                  <td>总金额(含税)</td><td><strong>${pricing.T.toFixed(2)} 元</strong></td>
                  <td>不含税单价</td><td>${(pricing.S/1.13).toFixed(0)} 元/吨</td>
                </tr>
                <tr>
                  <td>毛利(不含税)不含固定</td>
                  <td style="color:${pricing.BU>=0?'var(--success)':'var(--danger)'}">${pricing.BU.toFixed(0)} 元/吨</td>
                  <td>毛利(不含税)含固定</td>
                  <td style="color:${profitColor};font-weight:700">${pricing.BV.toFixed(0)} 元/吨</td>
                  <td><strong>毛利金额</strong></td>
                  <td style="color:${profitColor};font-weight:700;font-size:14px;">${pricing.U.toFixed(0)} 元</td>
                </tr>
              </table>
            </div>
          ` : ''}

          <div style="margin-top:8px;">
            <button class="btn btn-sm" onclick="App.showDetail(${idx})">查看详情</button>
          </div>
        </div>
      `;
    }).join('');

    // 汇总统计
    this.renderResults();
  },

  updateOrderPrice(idx, field, value) {
    if (!this.orderPrices[idx]) this.orderPrices[idx] = {};
    const v = parseFloat(value);
    if (!isNaN(v) && v > 0) {
      this.orderPrices[idx][field] = v;
      // 填了一个清另一个（互斥输入）
      if (field === 'sellingPricePerTon') {
        delete this.orderPrices[idx].totalAmount;
      } else if (field === 'totalAmount') {
        delete this.orderPrices[idx].sellingPricePerTon;
      }
    } else {
      delete this.orderPrices[idx][field];
    }
    this.renderProcessCost();
  },

  // ========== 密度管理 ==========

  getDensity(idx, type) {
    // 优先使用手动覆盖值
    if (this.densityOverrides[idx] && this.densityOverrides[idx][type] != null) {
      return this.densityOverrides[idx][type];
    }
    // 从牌号自动查询
    const item = this.parsedItems[idx];
    if (!item) return type === 'cladding' ? 8.0 : 7.85;
    const mat = type === 'cladding'
      ? CostCalculator.getCladdingMaterial(item.grade)
      : CostCalculator.getBaseMaterial(item.grade);
    const density = CostCalculator.lookupDensity(mat, type);
    return density != null ? density : (type === 'cladding' ? 8.0 : 7.85);
  },

  updateDensity(idx, type, value) {
    const v = parseFloat(value);
    if (!this.densityOverrides[idx]) this.densityOverrides[idx] = {};
    if (!isNaN(v) && v > 0) {
      this.densityOverrides[idx][type] = v;
    } else {
      delete this.densityOverrides[idx][type];
    }
    // 更新第一页和第二页
    this.renderRawMaterialDesign();
    this.renderLayoutPlan();
    this.renderProcessCost();
  },

  searchDensityOnline(material) {
    if (!material) {
      alert('请先输入材料牌号');
      return;
    }
    const url = CostCalculator.getDensitySearchUrl(material);
    window.open(url, '_blank');
  },

  // ========== 材料价格获取 ==========

  fetchSteelPrice(type) {
    // 获取当前第一条订单的材料牌号作为参考
    let material = '';
    let category = type;
    if (this.parsedItems.length > 0) {
      const item = this.parsedItems[0];
      if (type === 'carbon') {
        material = CostCalculator.getBaseMaterial(item.grade);
      } else {
        material = CostCalculator.getCladdingMaterial(item.grade);
        // 判断材料类别
        const cat = CostCalculator.MATERIAL_CATEGORY[material] || 'austenitic';
        if (cat === 'titanium') category = 'titanium';
        else if (cat === 'nickel') category = 'nickel';
      }
    }

    // 显示参考价格
    const ref = CostCalculator.lookupPriceReference(material, category);
    const inputId = type === 'carbon' ? 'carbonSteelPrice' : 'stainlessSteelPrice';
    const input = document.getElementById(inputId);
    const hintId = type === 'carbon' ? 'carbonPriceHint' : 'stainlessPriceHint';
    const hintEl = document.getElementById(hintId);

    if (ref) {
      if (hintEl) {
        hintEl.innerHTML = `<span class="badge badge-blue">参考价</span> ${ref.desc}: ${ref.min}~${ref.max} ${ref.unit} <span class="text-sm text-secondary">(数据仅供参考)</span>`;
      }
      // 如果输入框为空，自动填入中间值
      if (input && !input.value) {
        const mid = Math.round((ref.min + ref.max) / 2);
        input.value = mid;
        this.priceConfig[type === 'carbon' ? 'carbonSteelPrice' : 'stainlessSteelPrice'] = mid;
        this.renderProcessCost();
      }
    }

    // 打开网页搜索最新报价
    if (material) {
      const url = CostCalculator.getPriceSearchUrl(material);
      window.open(url, '_blank');
    } else {
      // 没有材料信息时打开通用搜索
      const searchTerm = type === 'carbon' ? '碳钢 Q235 价格 今日报价' : '不锈钢 304 价格 今日报价';
      window.open(`https://www.baidu.com/s?wd=${encodeURIComponent(searchTerm)}`, '_blank');
    }
  },

  // ========== 建议售价 ==========

  getSuggestedPrice(idx) {
    const pr = this.processResults[idx];
    if (!pr) return null;
    return CostCalculator.calculateSuggestedPrice(pr.cost, this.targetMarginRate);
  },

  applySuggestedPrice(idx) {
    const suggestion = this.getSuggestedPrice(idx);
    if (!suggestion || suggestion.suggestedPricePerTon <= 0) {
      alert('无法计算建议售价，请先填入原材料价格');
      return;
    }
    if (!this.orderPrices[idx]) this.orderPrices[idx] = {};
    this.orderPrices[idx].sellingPricePerTon = suggestion.suggestedPricePerTon;
    delete this.orderPrices[idx].totalAmount;
    this.renderProcessCost();
  },

  applyAllSuggestedPrices() {
    if (this.processResults.length === 0) {
      alert('请先添加规格数据');
      return;
    }
    let applied = 0;
    this.processResults.forEach((pr, idx) => {
      const suggestion = this.getSuggestedPrice(idx);
      if (suggestion && suggestion.suggestedPricePerTon > 0) {
        if (!this.orderPrices[idx]) this.orderPrices[idx] = {};
        this.orderPrices[idx].sellingPricePerTon = suggestion.suggestedPricePerTon;
        delete this.orderPrices[idx].totalAmount;
        applied++;
      }
    });
    this.renderProcessCost();
    if (applied > 0) {
      const hintEl = document.getElementById('suggestHint');
      if (hintEl) {
        hintEl.textContent = `已为 ${applied} 条订单填入建议报价（目标利润率 ${(this.targetMarginRate * 100).toFixed(0)}%）`;
        hintEl.className = 'alert alert-success';
      }
    }
  },
};

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', () => App.init());
