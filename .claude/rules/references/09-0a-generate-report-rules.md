# 09-0a DOCX 报告生成规则

> 所属：09-report（由 01-pipeline-rules.md Report 阶段引用）

## 前置条件

Markdown 报告已生成（`generate-report.mjs --project <NN-Project>`），`results/{module}/` 下有 `report.md`、`progress.txt`、`screenshots/`。

## 核心原则

全程在 batch.json 中组装。batch.json 直接写入已剔除占位 TC 的模板，不创建中间 docx 文件。

## 路径约定

| 文件 | 路径 |
|------|------|
| 模板（输入） | `.claude\templates\generate-report-template.docx`（**固定**） |
| 报告（输出） | `test_project/<项目>/results/<模块>/report.docx` |
| dump.json | `test_project/<项目>/results/<模块>/dump.json` |
| tc-block.json | `test_project/<项目>/results/<模块>/tc-block.json` |
| structure.json | `test_project/<项目>/results/<模块>/structure.json` |
| batch.json | `test_project/<项目>/results/<模块>/batch.json` |
| merged.json | `test_project/<项目>/results/<模块>/merged.json` |

中间文件（除模板和报告外）统一生成在 `test_project/<项目>/results/<模块>/`。

## 操作流程

### 步骤一：导出模板 dump

```bash
officecli dump .claude/templates/generate-report-template.docx -o test_project/<项目>/results/<模块>/dump.json
```

dump.json 是按顺序排列的命令数组，每条命令有 command、type、parent/path、props。

### 步骤二：分析模板结构，定位占位 TC

探查 dump.json 中的 add 命令，找到占位 TC 块的起始和结束索引：

| 特征 | 查找方式 |
|------|---------|
| 节标题（style=309） | `add type=p props.style="309"` |
| TC 子标题（style=314） | `add type=p props.style="314"` |
| 表标签（style=312） | `add type=p props.style="312"` |
| 注释标题（style=308） | `add type=p props.style="308"` |

p[N] 索引获取：dump 中过滤 `parent:'/body'` 的 `add type:'p'` 命令，按顺序编号。outline 中段落[N]对应 `/body/p[N]`。

占用位 TC 块的起止索引：从第一个 style=314 子标题到最后一个 TC 表格内容结束。

**常见错误**：统计 body 路径时，必须用 `c.type === 'p'` 过滤，不能统计所有 `add parent=/body` 命令。否则会把 table、sdt 等非段落元素计入 p[N] 序号。

### 步骤三：截取 tc-block.json

从完整的 dump.json 中截取第一个占位 TC 的命令序列（从 style=314 子标题到该 TC 表格内容结束），保存为 `test_project/<项目>/results/<模块>/tc-block.json`。这是后续克隆 TC 的模板。

同时记录 `test_project/<项目>/results/<模块>/structure.json`：

```json
{
  "funcSection": {
    "headingIndex": 941,
    "headingStyle": "146",
    "sectionHeadingStyle": "309"
  },
  "tcBlock": {
    "startIndex": 947,
    "endIndex": 1056,
    "subheadingStyle": "314",
    "tableLabelStyle": "312",
    "cellLabelStyle": "83",
    "cellContentStyle": "200"
  },
  "tcPlaceholders": [
    { "index": 947, "text": "卫星配置查询", "style": "314" }
  ]
}
```

### 步骤四：从 dump.json 剔除占位 TC

在 dump.json 中，删除所有占位 TC 的命令序列（从占位节标题 style=309 到最后一个 TC 表格内容结束）。保留注释/结论段落。保存。

剔除后的 dump.json 只包含模板的公共部分（封面、目录、样式、页眉页脚等），不包含任何 TC 内容。

**占位节标题查找方法**：从第一个 style=314 子标题向前找最近的 style=309 段落，即占位节标题。从该 style=309 开始删除，将占位节标题与占位 TC 一并移除。模块名在步骤六按模块动态生成。

### 步骤五：读取数据源

| 输入 | 来源 |
|------|------|
| TC 列表+状态 | `test_project/<项目>/results/<模块>/progress.txt` + `test_project/<项目>/results/<模块>/report.md` |
| 步骤与预期 | `test_project/<项目>/plans/*-{module}.md` |
| TC 模板 | `test_project/<项目>/results/<模块>/tc-block.json` |
| 模块名 | 脚本参数 |

### 步骤六：克隆 TC 模板 + 填入内容（状态追踪法）

从 tc-block.json 为每个 TC 生成 batch 命令。

**生成模块节标题**：在每个模块的第一个 TC 之前，先添加 style=309 段落作为模块节标题。节标题与 TC 一起按模块动态生成，不在模板中静态预留。

```javascript
batch.push({
  command: 'add',
  type: 'p',
  parent: '/body',
  props: { style: '309', text: moduleName }
});
```

**`set` 命令的 parent 陷阱**：dump.json 中 `set` 的 `parent` 字段是**空字符串**（`""`），不是路径。不能通过 `c.parent.includes(...)` 判断单元格位置。

必须用**状态追踪法**识别内容单元格：

```javascript
let lastWidth = '';
let currentLabel = '';

for (const c of block) {
  if (c.command === 'set' && c.props) {
    // 1. 追踪当前单元格的列宽
    if (c.props.width === '7067dxa') lastWidth = '7067dxa';    // 内容列（tc[2]）
    else if (c.props.width === '1838dxa') lastWidth = '1838dxa'; // 标签列（tc[1]）

    // 2. 追踪当前行标签（style=83 是标签单元格）
    if (c.props.style === '83' && c.props.text) { currentLabel = c.props.text; }

    // 3. 内容单元格判定：style=200 + 上一列为内容列
    //    ⚠ 不用 c.props.text 过滤：用例名称 content cell 的 set 命令无 text 属性
    if (c.props.style === '200' && lastWidth === '7067dxa') {
      switch (currentLabel) {
        case '用例名称':
          c.props.text = tc.name;
          break;
        case '涉及的需求': c.props.text = 'auth 模块自动化测试'; break;
        case '约束条件': c.props.text = tc.level + ' ' + moduleName + ' 模块测试约束'; break;
        case '预置条件': c.props.text = '系统已部署，服务正常运行'; break;
        case '测试步骤': c.props.text = stepText; break;
        case '预期结果': c.props.text = expectedText; break;
        case '判断标准': c.props.text = '测试通过准则：测试过程中系统无崩溃、卡死、无响应状况；执行结果符合预期结果。'; break;
        case '测试记录':
          c.props.text = steps.length > 0 ? '1. ' + steps[0] : '该用例已跳过';
          break;
        case '测试结果': c.props.text = tc.status; break;
        case '测试人员': c.props.text = '仓游'; break;
        case '测试时间': c.props.text = dateStr; break;
        case '备注': c.props.text = tc.status === 'SKIP' ? '该用例已跳过' : '无'; break;
      }
    }
  }
}
```

**填充规则**：
1. 深拷贝 tc-block.json
2. 替换子标题（style=314）text 为 `TC-XXX TC名称`
3. 替换表标签中的占位文字（见下方「表标签替换规则」）
4. 用状态追踪法填充 13 行内容单元格
5. 对**所有**有 `add r` 残留的内容单元格清空 run 文字（见下方「清空所有单元格 run 残留」）
6. 插入测试截图：在 测试记录 行内容后添加 add picture 命令（见「截图插入规则」）
7. 每个 TC 块后加空段落做间隔

#### 清空所有单元格 run 残留（强制）

tc-block.json 中每个内容单元格（tc[2]）的段落内都含有 `add r` 命令，携带模板的占位文字。**仅清空用例名称行不够**，必须清除**所有** tc[2] 内容单元格内的 `add r`，否则 `set` 写入的文字会与 `add r` 残留文字叠加（如 `set text="通过"` + `add r "不通过"` → 渲染为 `"通过不通过"`）。

**识别规则**：`add type='r'` 且 `parent` 包含 `tc[2]`（即内容列单元格内）：

```javascript
for (const c of block) {
  if (c.command === 'add' && c.type === 'r' && c.parent && c.parent.includes('tc[2]')) {
    c.props.text = '';
  }
}
```

位置：在状态追踪填充**之后**、push 到 batch **之前**执行。清空后不影响表标签区域（表标签的 `add r` parent 为 `/body/p[last()]`，不包含 `tc[2]`）。

#### 表标签替换规则

tc-block 中 style=312 段落后面有一系列 `add r` 命令，模板原文类似：

```
add r "表 "           ← 保留
add field "3"          ← 自动编号，保留
add r " "              ← 保留
add r "卫星配置"       ← 占位文字，需替换为 TC 名称前半
add r "查询"           ← 占位文字，需替换为 TC 名称后半
add r "测试用例"       ← 保留
add r "T-002"          ← 替换为 TC 编号（如 TC-001）
```

**替换方法**：遍历 block 中 style=312 之后的连续 `add type='r'` 命令，识别并替换占位文字：

```javascript
let inTableLabel = false;
let rCount = 0;
for (const c of block) {
  if (c.command === 'add' && c.type === 'p' && c.props?.style === '312') {
    inTableLabel = true; rCount = 0; continue;
  }
  if (inTableLabel && c.command === 'add' && c.type === 'r') {
    rCount++;
    if (rCount === 3) c.props.text = tc.name;  // "卫星配置" → TC 名称
    if (rCount === 4) c.props.text = '';         // "查询" → 清空
    if (rCount === 6) c.props.text = tc.id;      // "T-002" → TC-001
  }
  if (inTableLabel && c.command === 'add' && c.type === 'table') {
    inTableLabel = false;
  }
}
```

#### 测试记录填充规则

`测试记录` 行由**步骤文本**组成，通过 `set` 命令写入。模板中预留的 `add picture` 占位图**必须清除**（生成脚本中删除）。

**模板结构**（tc-block.json 中测试记录行共 4 条命令）：

```
set style=200 text="1."        ← 步骤文本
add p style=200                ← 空行
add picture                     ← ⚠ 占位图，须删除（旧模板残留）
```

**解析逻辑**：从 report.md 提取每个 TC 的步骤，清洗格式。

原始 report.md 中的步骤格式为 `1. TC-001-1: 导航到首页并退出当前登录 - OK`，需要：
- 去掉行首序号 `\d+\.\s+`
- 去掉 `TC-XXX-X:` 前缀
- 去掉 `- OK` / `- FAIL` 后缀
- 只保留 `导航到首页并退出当前登录`

```javascript
function parseReportTC(reportMd, tcId) {
  const escId = tcId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('### ' + escId + ':.*?\\n([\\s\\S]*?)(?=### TC-|## 环境|\\n## |$)', '');
  const match = reportMd.match(regex);
  if (!match) return { steps: [] };

  const section = match[1];
  const steps = [];

  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (/^\d+\.\s+TC-/.test(trimmed)) {
      // "1. TC-001-1: xxx - OK" → "xxx"
      let step = trimmed;
      step = step.replace(/^\d+\.\s+/, '');            // 去掉行首 "1. "
      step = step.replace(/TC-[\w-]+:\s*/, '');        // 去掉 "TC-XXX-X: "
      step = step.replace(/\s*-\s*(OK|FAIL|PASS)$/, ''); // 去掉 "- OK"/"- FAIL"/"- PASS"
      steps.push(step);
    }
  }
  return { steps };
}
```

**填充规则**：

格式为 `1. 步骤1\n截图1\n2. 步骤2\n截图2\n...`，每个步骤后紧跟对应截图。即**图文交错**格式：单段文字配一张截图，换行后下一段文字配截图。

**步骤解析**：将清洗后的步骤存入数组，每个元素为一条步骤文字（不含序号）。

**截图分配**：截图文件按文件名排序，按数组顺序与步骤一一对应：
- `screenshots[0]` → 步骤 1
- `screenshots[1]` → 步骤 2
- 截图数不足时后续步骤无截图；无截图时只显示步骤文字

**操作流程**：

1. 删除模板占位截图及其前一个空行，记录 `pictureParent`（占位图的 parent 路径，如 `/body/table[1]/tr[8]/tc[2]/p[2]`）
2. 从 `pictureParent` 推导 `cellParent`（去掉 `/p[N]` 后缀，即 `/body/table[1]/tr[8]/tc[2]`）—— ⚠ 占位图所在空行已删除，**不可**用 `pictureParent` 直接添加
3. 状态追踪中，`测试记录` 的 `set` 只填第一步文字：`1. ${steps[0]}`
4. 新建空行段落作为第 1 步的截图容器，插入第一张截图
5. 从步骤 2 开始遍历，每步生成 `add p style=200 text="N. 步骤"` → `add p style=200`（空行放截图）→ `add picture`

```javascript
function getScreenshots(tcId) {
  try {
    const num = tcId.split('-')[1];
    const prefix = 'tc-' + num + '-';
    const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.startsWith(prefix));
    files.sort();
    return files.map(f => path.resolve(SCREENSHOT_DIR, f));
  } catch (e) {
    return [];
  }
}
```

#### 合格判定行的特殊处理

`合格判定` 行的内容单元格使用 `style=83`（不是 `style=200`），不受状态追踪法覆盖。通过查找 `add r` 命令直接替换文字：

```javascript
const statusMap = { PASS: '通过', FAIL: '不通过', SKIP: '跳过' };
let foundJudgment = false, judgmentHandled = false;
for (const c of block) {
  if (c.command === 'set' && c.props?.style === '83' && c.props.text === '合格判定') {
    foundJudgment = true;
  } else if (foundJudgment && c.command === 'add' && c.type === 'r' && !judgmentHandled) {
    c.props.text = statusMap[tc.status];
    judgmentHandled = true;
  } else if (foundJudgment && c.command === 'add' && c.type === 'r' && judgmentHandled) {
    c.props.text = '';
  }
}
```

#### 截图插入完整代码

```javascript
const { steps } = parseReportTC(REPORT_MD, tc.id);
const screenshots = getScreenshots(tc.id);

// 从克隆的 block 中删除占位图片及其前一个空行 add p
let pictureParent = '';
const removeIndices = [];
for (let i = 0; i < block.length; i++) {
  const c = block[i];
  if (c.command === 'add' && c.type === 'picture') {
    pictureParent = c.parent;
    removeIndices.push(i);
    if (i > 0 && block[i-1].command === 'add' && block[i-1].type === 'p') {
      removeIndices.push(i-1);
    }
  }
}
removeIndices.sort((a,b) => b - a).forEach(idx => block.splice(idx, 1));

// 从 pictureParent 推导 cellParent（内容单元格路径）
// "/body/table[1]/tr[8]/tc[2]/p[2]" → "/body/table[1]/tr[8]/tc[2]"
const cellParent = pictureParent ? pictureParent.substring(0, pictureParent.lastIndexOf('/')) : '';

// 插入步骤截图对（在状态追踪填充之后执行）
// ⚠ pictureParent 引用的 p[2] 已被删除，不能直接用 — 须新建空行段落
if (steps.length > 0 && cellParent) {
  let pIdx = 2; // p[1] 是模板已有的步骤文字段落

  // 第 1 步截图：新建空行段落（p[2]）→ 插入截图
  if (screenshots.length > 0) {
    block.push({
      command: 'add', type: 'p', parent: cellParent,
      props: { style: '200' }
    }); // 创建 p[pIdx]
    block.push({
      command: 'add', type: 'picture',
      parent: `${cellParent}/p[${pIdx}]`,
      props: { path: screenshots[0], width: '4000000', height: '2250000' }
    });
    pIdx++; // pIdx = 3
  }

  // 第 2..N 步：每步一段文字 → 一个空行（截图容器）→ 一张截图
  for (let i = 1; i < steps.length; i++) {
    block.push({
      command: 'add', type: 'p', parent: cellParent,
      props: { style: '200', text: `${i+1}. ${steps[i]}` }
    }); // 创建 p[pIdx]
    pIdx++;
    block.push({
      command: 'add', type: 'p', parent: cellParent,
      props: { style: '200' }
    }); // 创建 p[pIdx]
    pIdx++;
    if (i < screenshots.length) {
      block.push({
        command: 'add', type: 'picture',
        parent: `${cellParent}/p[${pIdx - 1}]`,
        props: { path: screenshots[i], width: '4000000', height: '2250000' }
      });
    }
  }
}
```

**注意**：
- SKIP 状态的 TC 没有步骤，文本填 `该用例已跳过`
- **禁止**将截图路径以文本形式填入 `c.props.text`
- 截图按文件名排序后与步骤顺序对应，不是按语义匹配
- 截图数少于步骤数时，后续步骤无截图
- `cellParent` 从占位图的 `parent` 计算：去掉最后的 `/p[N]` 段即为内容单元格路径

### 步骤七：合并并导入

batch.json 只包含新 TC 的 add 命令序列。将 batch.json 直接合并到已剔除占位 TC 的 dump.json 末尾，一步 batch 导入。

```bash
node -e "const d=require('./test_project/<项目>/results/<模块>/dump.json'),b=require('./test_project/<项目>/results/<模块>/batch.json'); require('fs').writeFileSync('test_project/<项目>/results/<模块>/merged.json', JSON.stringify([...d,...b],null,2))"

# ⚠ 删除已有 docx，确保从空文档开始（禁止重复 batch 导致内容叠加）
rm -f "test_project/<项目>/results/<模块>/report.docx"
officecli create "test_project/<项目>/results/<模块>/report.docx"
officecli batch "test_project/<项目>/results/<模块>/report.docx" --input "test_project/<项目>/results/<模块>/merged.json" --force
```

### 步骤八：验证

```bash
officecli view "test_project/<项目>/results/<模块>/report.docx" outline
officecli view "test_project/<项目>/results/<模块>/report.docx" text
```

### 步骤九：关闭文档

验证完成后关闭文档，释放 resident 进程：

```bash
officecli close "test_project/<项目>/results/<模块>/report.docx"
```

### 步骤十：清除中间文件

保留最终 `report.docx`，删除过程中产生的中间文件：

```bash
rm -f "test_project/<项目>/results/<模块>/dump.json" "test_project/<项目>/results/<模块>/tc-block.json" "test_project/<项目>/results/<模块>/structure.json"
rm -f "test_project/<项目>/results/<模块>/batch.json" "test_project/<项目>/results/<模块>/merged.json"
```

## 核心约束

### 禁止空 props

batch 中的 `set` 命令必须携带至少一个 prop（`key=value`）。**禁止空 props**（`{}`）。如需清空文字用 `text=""`。

### 禁止 remove

生成脚本中禁止使用 `remove` 命令。占位 TC 在步骤四中已经从 dump.json 剔除，不在每次生成时动态删除。

### 禁止创建中间 docx

生成脚本中禁止创建 `clean-template*.docx` 等中间文件。batch.json 直接应用到原始模板（已剔除占位 TC）。

### 禁止在脚本中调用 `officecli query`

### 禁止重复 batch（强制）

**每个 `.docx` 文件仅允许执行一次 `officecli batch`。** 同一个 batch（merged.json）对同一个文档重复应用会导致内容叠加（如 TC 重复、截图重复）。

生成流程中的 `officecli batch` 调用必须是幂等的——如果发现文档已存在（非空），**必须删除重建**，而不是追加 batch。

检查方法：batch 前检查 `.docx` 是否存在且内容为空（刚 `create` 出来的空文档），否则先删除再 `create`。

```bash
# 正确流程：create → batch（仅一次）
officecli create "report.docx"
officecli batch "report.docx" --input "merged.json" --force
# 禁止再次执行上面这行 batch
```

### 禁止模式汇总

- ❌ `set` 不带 props
- ❌ 使用 `remove` 命令
- ❌ 在脚本中调用 `officecli query`
- ❌ 创建 `clean-template*.docx` 等中间文件
- ❌ 对同一个 `.docx` 执行两次或以上 `officecli batch`
- ❌ 通过 `parent` 路径判断单元格位置（`set` 无 parent）
- ✅ **必须用状态追踪法**识别内容单元格
