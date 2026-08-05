/**
 * 生产通知单文档解析器
 * 支持 .docx (通过 mammoth.js) 和 .doc (通过文本提取) 格式
 */

const DocParser = {

  /**
   * 解析上传的文件
   * @param {File} file - 上传的文件
   * @returns {Promise<Array>} 解析出的规格列表
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
   * .doc 是 OLE 复合文档, 文本通常以 UTF-16LE 或 ASCII 存储
   */
  extractTextFromDoc(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let text = '';

    // 方法1: 尝试提取 UTF-16LE 文本
    // .doc 文件中文本通常存储在 WordDocument 流中
    // 简单方法: 扫描整个文件, 提取可打印的 UTF-16LE 字符
    const decoder = new TextDecoder('utf-16le');
    const chunks = [];
    let inText = false;
    let chunkStart = -1;

    for (let i = 0; i < bytes.length - 1; i += 2) {
      const code = bytes[i] | (bytes[i + 1] << 8);

      // 可打印字符范围 (包括中文 CJK 统一汉字、ASCII 可打印字符、全角字符)
      const isPrintable =
        (code >= 0x20 && code <= 0x7e) ||  // ASCII 可打印
        (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一汉字
        (code >= 0x3000 && code <= 0x303f) || // CJK 标点符号
        (code >= 0xff00 && code <= 0xffef) || // 全角字符
        code === 0x0a || code === 0x0d ||  // 换行
        code === 0x09 ||  // 制表符
        (code >= 0x2000 && code <= 0x206f); // 通用标点

      if (isPrintable) {
        if (!inText) {
          chunkStart = i;
          inText = true;
        }
      } else {
        if (inText && i - chunkStart >= 4) {
          // 提取足够长的文本块
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
   * 生产通知单表格格式:
   * 序号 | 钢种 | 复层厚度 | 基层厚度 | 宽度 | 长度 | 单重 | 张数 | 吨位 | 备注
   */
  parseText(text) {
    // 统一分隔符: 将 \a (bell char 0x07, .doc表格分隔符) 替换为 tab
    text = text.replace(/\x07/g, '\t');

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);

    // 查找表格数据行
    // 表格特征: 包含序号(数字) + 钢种(含+) + 厚度 + 宽度 + 长度等
    const items = [];

    for (const line of lines) {
      const parsed = this.parseLine(line);
      if (parsed) {
        items.push(parsed);
      }
    }

    // 如果没有解析到数据行, 尝试用 tab/多空格分割的方式重新解析
    if (items.length === 0) {
      for (const line of lines) {
        const parsed = this.parseTabLine(line);
        if (parsed) {
          items.push(parsed);
        }
      }
    }

    if (items.length === 0) {
      throw new Error('未能从文件中解析出生产通知单数据，请检查文件内容或手动输入参数');
    }

    return items;
  },

  /**
   * 解析单行数据
   * 尝试匹配: 序号 钢种 复层厚度 基层厚度 宽度 长度 [单重] 张数 [吨位] [备注]
   */
  parseLine(line) {
    // 用 tab 或多个空格分割
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

    // 钢种后面的字段应该是: 复层厚度 基层厚度 宽度 长度 [单重] 张数 [吨位] [备注]
    const remaining = parts.slice(gradeIdx + 1);
    if (remaining.length < 4) return null;

    // 提取数字 (去除单位后缀)
    const numbers = remaining.map(p => {
      const cleaned = p.replace(/[a-zA-Z㎜㎡mm吨张元\/%()（）]/g, '').trim();
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    });

    // 找到连续的数字序列
    // 期望: 复层厚度 基层厚度 宽度 长度 [单重] 张数
    let numIdx = 0;
    const claddingThickness = numbers[numIdx++];
    const baseThickness = numbers[numIdx++];
    const width = numbers[numIdx++];
    const length = numbers[numIdx++];

    if (!claddingThickness || !baseThickness || !width || !length) return null;

    // 厚度通常 < 100mm, 宽度通常 300-6000mm, 长度通常 500-20000mm
    if (claddingThickness > 50 || baseThickness > 200) return null;
    if (width < 300 || width > 6000) return null;
    if (length < 500 || length > 20000) return null;

    // 接下来可能是: 单重(吨) 张数 或 直接是 张数
    // 单重通常 < 10 (吨), 张数通常是整数
    let sheets = 1;
    if (numIdx < numbers.length) {
      const next1 = numbers[numIdx];
      if (next1 !== null) {
        if (next1 < 50 && next1 === Math.floor(next1)) {
          // 可能是张数
          sheets = next1;
          numIdx++;
        } else if (next1 < 10) {
          // 可能是单重, 继续找张数
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
      grade: parts[gradeIdx].trim(),
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

    // 第一列应该是序号 (数字)
    const seq = parseInt(parts[0]);
    if (isNaN(seq)) return null;

    // 第二列是钢种
    const grade = parts[1];
    if (!grade || grade.length < 2) return null;

    // 后续列: 复层厚度 基层厚度 宽度 长度 [单重] [张数] [吨位] [备注]
    const claddingThickness = parseFloat(parts[2]);
    const baseThickness = parseFloat(parts[3]);
    const width = parseFloat(parts[4]);
    const length = parseFloat(parts[5]);

    if (isNaN(claddingThickness) || isNaN(baseThickness) || isNaN(width) || isNaN(length)) {
      return null;
    }

    // 厚度合理性检查
    if (claddingThickness > 50 || baseThickness > 200) return null;
    if (width < 500 || width > 5000) return null;
    if (length < 1000 || length > 15000) return null;

    // 找张数: 可能在第7或第8列
    let sheets = 1;
    for (let i = 6; i < parts.length; i++) {
      const num = parseFloat(parts[i]);
      if (!isNaN(num) && num >= 1 && num === Math.floor(num) && num <= 500) {
        sheets = Math.round(num);
        break;
      }
    }

    return {
      grade,
      claddingThickness,
      baseThickness,
      width,
      length,
      sheets,
    };
  },
};

// 导出到全局
if (typeof window !== 'undefined') {
  window.DocParser = DocParser;
}
