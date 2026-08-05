/**
 * 生产通知单文档解析器
 * 支持 .docx (通过 mammoth.js) 和 .doc (通过文本提取) 格式
 * 支持两种格式：
 *   1. 分列格式: 序号\t钢种\t复层厚度\t基层厚度\t宽度\t长度\t张数
 *   2. 合并格式: 钢种 (14+2)*1500*4150 单重 张数 吨位
 *      圆形板: (14+2)Ф1420
 */

const DocParser = {

  /**
   * 解析上传的文件
   */
  async parse(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'docx') {
      return await this.parseDocx(file);
    } else if (ext === 'doc') {
      return await this.parseDoc(file);
    } else if (ext === 'txt') {
      const text = await file.text();
      return this.parseText(text);
    } else {
      throw new Error('不支持的文件格式，请上传 .doc 或 .docx 文件');
    }
  },

  /**
   * 解析 .docx 文件 (使用 mammoth.js)
   */
  async parseDocx(file) {
    if (typeof mammoth === 'undefined') {
      throw new Error('mammoth.js 未加载，无法解析 .docx 文件');
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return this.parseText(result.value);
  },

  /**
   * 解析 .doc 文件 (二进制格式, 提取文本)
   */
  async parseDoc(file) {
    const arrayBuffer = await file.arrayBuffer();
    const text = this.extractTextFromDoc(arrayBuffer);
    return this.parseText(text);
  },

  /**
   * 从 .doc 二进制文件中提取文本
   * .doc 是 OLE 复合文档, 文本通常以 UTF-16LE 存储
   */
  extractTextFromDoc(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let text = '';

    // 方法1: 尝试提取 UTF-16LE 文本
    const decoder = new TextDecoder('utf-16le');
    const chunks = [];
    let inText = false;
    let chunkStart = -1;

    for (let i = 0; i < bytes.length - 1; i += 2) {
      const code = bytes[i] | (bytes[i + 1] << 8);

      // 可打印字符范围
      const isPrintable =
        (code >= 0x20 && code <= 0x7e) ||         // ASCII 可打印
        (code >= 0x00c0 && code <= 0x00ff) ||     // Latin-1 补充 (含 Ø ø Ð 等)
        (code >= 0x0370 && code <= 0x03ff) ||     // 希腊字母 (含 Φ φ)
        (code >= 0x0400 && code <= 0x04ff) ||     // 西里尔字母 (含 Ф ф)
        (code >= 0x4e00 && code <= 0x9fff) ||     // CJK 统一汉字
        (code >= 0x3000 && code <= 0x303f) ||     // CJK 标点符号
        (code >= 0xff00 && code <= 0xffef) ||     // 全角字符
        code === 0x0a || code === 0x0d ||          // 换行
        code === 0x09 ||                           // 制表符
        (code >= 0x2000 && code <= 0x206f);        // 通用标点

      if (isPrintable) {
        if (!inText) {
          chunkStart = i;
          inText = true;
        }
      } else {
        if (inText && i - chunkStart >= 4) {
          const chunk = decoder.decode(bytes.slice(chunkStart, i));
          chunks.push(chunk);
        }
        inText = false;
      }
    }

    // 处理最后的块
    if (inText && bytes.length - chunkStart >= 4) {
      const chunk = decoder.decode(bytes.slice(chunkStart, bytes.length));
      chunks.push(chunk);
    }

    text = chunks.join('\n');

    // 如果 UTF-16LE 方法提取的文本太少, 尝试 ASCII/GBK 方法
    if (text.length < 50) {
      text = this.extractAsciiFromDoc(bytes);
    }

    return text;
  },

  /**
   * 从 .doc 文件中提取 ASCII/GBK 文本 (备用方法)
   */
  extractAsciiFromDoc(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b >= 0x20 && b <= 0x7e) {
        text += String.fromCharCode(b);
      } else if (b === 0x0a || b === 0x0d) {
        text += '\n';
      } else if (b === 0x09) {
        text += '\t';
      }
    }
    return text;
  },

  /**
   * 从提取的文本中解析生产通知单数据
   */
  parseText(text) {
    // 统一分隔符: 将 \a (bell char 0x07, .doc表格分隔符) 替换为 tab
    text = text.replace(/\x07/g, '\t');

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);

    // 尝试方式1: 分列格式 (旧格式, 每行包含完整的规格数据)
    const items = [];
    for (const line of lines) {
      const parsed = this.parseLine(line);
      if (parsed) {
        items.push(parsed);
      }
    }

    // 尝试方式2: tab分割格式
    if (items.length === 0) {
      for (const line of lines) {
        const parsed = this.parseTabLine(line);
        if (parsed) {
          items.push(parsed);
        }
      }
    }

    // 尝试方式3: 合并尺寸格式 (新格式, 尺寸为 (14+2)*1500*4150)
    if (items.length === 0) {
      const combinedItems = this.parseCombinedFormat(lines);
      items.push(...combinedItems);
    }

    if (items.length === 0) {
      throw new Error('未能从文件中解析出生产通知单数据，请检查文件内容或手动输入参数');
    }

    return items;
  },

  /**
   * 解析单行数据 (分列格式)
   */
  parseLine(line) {
    const parts = line.split(/[\t]+|\s{2,}/).map(p => p.trim()).filter(p => p);

    if (parts.length < 6) return null;

    // 尝试识别钢种 (包含 + 号)
    let gradeIdx = -1;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].includes('+')) {
        gradeIdx = i;
        break;
      }
    }

    if (gradeIdx === -1) return null;

    const remaining = parts.slice(gradeIdx + 1);
    if (remaining.length < 4) return null;

    const numbers = remaining.map(p => {
      const cleaned = p.replace(/[a-zA-Z㎜㎡mm吨张元\/%()（）]/g, '').trim();
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    });

    let numIdx = 0;
    const claddingThickness = numbers[numIdx++];
    const baseThickness = numbers[numIdx++];
    const width = numbers[numIdx++];
    const length = numbers[numIdx++];

    if (!claddingThickness || !baseThickness || !width || !length) return null;

    if (claddingThickness > 50 || baseThickness > 200) return null;
    if (width < 300 || width > 6000) return null;
    if (length < 500 || length > 20000) return null;

    let sheets = 1;
    if (numIdx < numbers.length) {
      const next1 = numbers[numIdx];
      if (next1 !== null) {
        if (next1 < 50 && next1 === Math.floor(next1)) {
          sheets = next1;
          numIdx++;
        } else if (next1 < 10) {
          numIdx++;
          if (numIdx < numbers.length && numbers[numIdx] !== null) {
            sheets = numbers[numIdx];
            numIdx++;
          }
        }
      }
    }

    if (sheets < 1) sheets = 1;
    sheets = Math.round(sheets);

    return {
      grade: this.normalizeGrade(parts[gradeIdx].trim()),
      claddingThickness,
      baseThickness,
      width,
      length,
      sheets,
    };
  },

  /**
   * 备用解析: 处理 tab 分割的行
   */
  parseTabLine(line) {
    const parts = line.split('\t').map(p => p.trim()).filter(p => p);
    if (parts.length < 6) return null;

    const seq = parseInt(parts[0]);
    if (isNaN(seq)) return null;

    const grade = parts[1];
    if (!grade || grade.length < 2) return null;

    const claddingThickness = parseFloat(parts[2]);
    const baseThickness = parseFloat(parts[3]);
    const width = parseFloat(parts[4]);
    const length = parseFloat(parts[5]);

    if (isNaN(claddingThickness) || isNaN(baseThickness) || isNaN(width) || isNaN(length)) {
      return null;
    }

    if (claddingThickness > 50 || baseThickness > 200) return null;
    if (width < 500 || width > 5000) return null;
    if (length < 1000 || length > 15000) return null;

    let sheets = 1;
    for (let i = 6; i < parts.length; i++) {
      const num = parseFloat(parts[i]);
      if (!isNaN(num) && num >= 1 && num === Math.floor(num) && num <= 500) {
        sheets = Math.round(num);
        break;
      }
    }

    return {
      grade: this.normalizeGrade(grade),
      claddingThickness,
      baseThickness,
      width,
      length,
      sheets,
    };
  },

  // ========== 合并尺寸格式解析 (新) ==========

  /**
   * 解析合并尺寸格式
   * 格式: 牌号 (14+2)*1500*4150 单重 吨位
   *   或: 牌号 (14+2)Ф1420 单重 吨位
   * 每个字段可能在单独的行
   */
  parseCombinedFormat(lines) {
    const items = [];
    let i = 0;

    // 需要跳过的标题/文本行关键词
    const skipKeywords = [
      '合计', '序号', '材质', '厚度', '单重', '数量', '技术', '质量', '计重',
      '合同', '货运', '交货', '营销', '业务', '经办', '客户', '订单', '应用',
      '日期', '安徽', '生产', '自接', '储罐', '理算', '自提', '标准', '执行',
      '毛边', '交付', '满足', '全部', '货物', '条件', '名称', '属性', '场景',
      '方式', '地点', '顺序', '经理', '时间', '张吨', '张', '吨', '备注',
    ];

    while (i < lines.length) {
      const line = lines[i].trim();

      // 跳过标题/文本行
      if (skipKeywords.some(kw => line.includes(kw)) && !line.match(/\(\d+\+\d+\)/)) {
        i++;
        continue;
      }

      // 尝试匹配牌号 (包含 + 且至少一边以字母开头)
      const gradeMatch = line.match(/([A-Za-z][A-Za-z0-9]*\+[A-Za-z0-9]+)/);
      if (!gradeMatch) {
        i++;
        continue;
      }

      const grade = gradeMatch[1];
      const afterGradePos = gradeMatch.index + gradeMatch[0].length;
      const restOfLine = line.substring(afterGradePos).trim();

      // 尝试从当前行剩余部分解析尺寸
      let dim = this.parseDimensionString(restOfLine);
      let consumedLines = 0;

      if (!dim) {
        // 尺寸可能在下一行
        let nextIdx = i + 1;
        while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;

        if (nextIdx < lines.length) {
          const nextLine = lines[nextIdx].trim();
          dim = this.parseDimensionString(nextLine);

          if (!dim) {
            // 可能是圆形板, 尺寸只有 (14+2), 直径在下一行
            const thickOnly = nextLine.match(/^\((\d+)\+(\d+)\)$/);
            if (thickOnly) {
              let diamIdx = nextIdx + 1;
              while (diamIdx < lines.length && !lines[diamIdx].trim()) diamIdx++;

              if (diamIdx < lines.length) {
                const diamLine = lines[diamIdx].trim();
                // 直径可能带有 Ф 前缀或只是数字
                const diamMatch = diamLine.match(/[ФΦDdøØ]?\s*(\d{3,5})/);
                if (diamMatch) {
                  const diameter = parseFloat(diamMatch[1]);
                  if (diameter > 100) {
                    dim = {
                      baseThickness: parseInt(thickOnly[1]),
                      claddingThickness: parseInt(thickOnly[2]),
                      diameter: diameter,
                      width: diameter,
                      length: diameter,
                      isCircular: true,
                    };
                    consumedLines = diamIdx - i;
                  }
                }
              }
            }
          } else {
            consumedLines = nextIdx - i;
          }
        }
      }

      if (!dim) {
        i++;
        continue;
      }

      // 查找重量数据 (单重和总重)
      const weightStartIdx = i + consumedLines + 1;
      const weights = this.findWeightsInLines(lines, weightStartIdx);

      if (!weights) {
        i++;
        continue;
      }

      // 构建解析结果
      const item = {
        grade: this.normalizeGrade(grade),
        claddingThickness: dim.claddingThickness,
        baseThickness: dim.baseThickness,
        width: dim.width,
        length: dim.length,
        sheets: weights.sheets,
      };

      if (dim.isCircular) {
        item.isCircular = true;
        item.diameter = dim.diameter;
      }

      items.push(item);
      i = weights.nextIndex;
    }

    return items;
  },

  /**
   * 解析尺寸字符串
   * 支持: (14+2)*1500*4150, (14+2)Ф1420, (14+2)×1500×4150 等
   */
  parseDimensionString(str) {
    if (!str) return null;

    // 矩形板: (14+2)*1500*4150
    const rectMatch = str.match(/\((\d+)\+(\d+)\)\s*[*×xX]\s*(\d+\.?\d*)\s*[*×xX]\s*(\d+\.?\d*)/);
    if (rectMatch) {
      const baseThickness = parseInt(rectMatch[1]);
      const claddingThickness = parseInt(rectMatch[2]);
      const width = parseFloat(rectMatch[3]);
      const length = parseFloat(rectMatch[4]);

      if (baseThickness > 0 && baseThickness < 200 && claddingThickness > 0 && claddingThickness < 50 &&
          width > 300 && width < 6000 && length > 500 && length < 20000) {
        return {
          baseThickness,
          claddingThickness,
          width,
          length,
          isCircular: false,
        };
      }
    }

    // 圆形板: (14+2)Ф1420, (14+2)Φ1420, (14+2)D1420, (14+2) 1420
    const circMatch = str.match(/\((\d+)\+(\d+)\)\s*[ФΦDdøØ]?\s*(\d{3,5})/);
    if (circMatch) {
      const baseThickness = parseInt(circMatch[1]);
      const claddingThickness = parseInt(circMatch[2]);
      const diameter = parseFloat(circMatch[3]);

      if (baseThickness > 0 && baseThickness < 200 && claddingThickness > 0 && claddingThickness < 50 &&
          diameter > 200 && diameter < 6000) {
        return {
          baseThickness,
          claddingThickness,
          diameter,
          width: diameter,
          length: diameter,
          isCircular: true,
        };
      }
    }

    return null;
  },

  /**
   * 从后续行中查找重量数据
   * 返回 { singleWeight, totalWeight, sheets, nextIndex }
   */
  findWeightsInLines(lines, startIdx) {
    const weights = [];
    let idx = startIdx;

    while (idx < lines.length && weights.length < 2) {
      const line = lines[idx].trim();
      if (!line) { idx++; continue; }

      // 查找小数 (如 0.783, 1.208)
      const numMatch = line.match(/^(\d+\.\d+)\s*$/);
      if (numMatch) {
        weights.push(parseFloat(numMatch[1]));
      } else {
        // 如果遇到非数字行且已有至少一个重量, 停止
        if (weights.length > 0) break;

        // 尝试从混合行中提取数字
        const mixedMatch = line.match(/(\d+\.\d+)/);
        if (mixedMatch) {
          weights.push(parseFloat(mixedMatch[1]));
        }
      }
      idx++;
    }

    if (weights.length === 0) return null;

    const singleWeight = weights[0];
    const totalWeight = weights.length > 1 ? weights[1] : singleWeight;

    // 计算张数: 总重 / 单重
    let sheets = 1;
    if (singleWeight > 0) {
      sheets = Math.round(totalWeight / singleWeight);
      if (sheets < 1) sheets = 1;
    }

    return {
      singleWeight,
      totalWeight,
      sheets,
      nextIndex: idx,
    };
  },

  /**
   * 标准化牌号格式
   * 如果是"基层+复层"格式 (如 Q345R+304), 转换为"复层+基层" (如 304+Q345R)
   */
  normalizeGrade(grade) {
    if (!grade) return grade;
    const parts = grade.split('+').map(p => p.trim());
    if (parts.length !== 2) return grade;

    const first = parts[0].toUpperCase();
    const second = parts[1].toUpperCase();

    // 已知基层材料 (碳钢/低合金钢)
    const isBaseMaterial = (s) => {
      return /^(Q\d|20R?|16M|A516|SA516|SS400|SPV|P\d)/.test(s) ||
             ['Q235B','Q235C','Q345R','Q245R','Q345B','Q355B','Q370R',
              '20R','20G','16MN','16MN','A516','SA516','SS400','SPV355',
              'P265GH','P355GH','SB410'].includes(s);
    };

    // 已知复层材料 (不锈钢/钛/镍/铜)
    const isCladdingMaterial = (s) => {
      return /^(S\d|TA\d|N0?6|N08|TU|T2?|H6|B1|B3)/.test(s) ||
             ['304','304L','316','316L','316TI','321','310S','309S',
              '2205','2507','2304','904L','254SMO'].includes(s);
    };

    // 如果第一个是基层, 第二个是复层, 交换顺序
    if (isBaseMaterial(first) && isCladdingMaterial(second)) {
      return parts[1] + '+' + parts[0];
    }

    return grade;
  },
};

// 导出到全局
if (typeof window !== 'undefined') {
  window.DocParser = DocParser;
}
