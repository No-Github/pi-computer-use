# 玉衡 `pi-computer-use` Fork 二开计划

日期：2026-09-02
基线：`4b8dbd7` / `0.5.1`
维护仓库：`No-Github/pi-computer-use`
上游仓库：`injaneity/pi-computer-use`

## 1. 背景

玉衡已经把 Fork 作为可插拔的桌面操作运行时使用。近期会话暴露了两类根因：

1. `find_roots` 或 `observe_ui` 返回的窗口引用在窗口激活、重建、切换后可能失效，运行时仍会继续复用旧引用，最终出现 `Root is not owned by a running app`。
2. 自绘编辑器（例如 Zed）没有可用的 AX 正文节点，通用 UI 树可以发送输入，却不能可靠证明文本已写入。Agent 因此可能退回 `osascript`，或在没有新观察结果时猜坐标继续操作。

这次 Fork 只维护通用桌面能力；玉衡自己的产品策略（是否允许 Shell、项目目录、用户确认和提示词）仍由玉衡适配层负责。

## 2. 目标

- 让根引用具有明确的生命周期、身份和失效原因。
- 让每次桌面动作都绑定一个不可变观察状态，并保持单根事务边界。
- 为自绘界面提供带观察证据的视觉目标，而不是裸坐标重放。
- 将“动作已发送”和“目标状态已验证”分开返回。
- 通过通用动作效果评估提升验证率，不把应用逻辑硬编码进 bridge。
- 保持现有工具名称和调用方式兼容，逐步增强返回的结构化详情。

## 3. 非目标

- 不在 Fork 中实现玉衡业务权限、工作目录或项目模型。
- 不禁用所有 `bash`；桌面自动化绕过策略由玉衡的 `ToolSecurityPolicy` 控制。
- 不承诺对任意自绘应用进行无证据的像素级自动化。
- 不改变 Browser Use 的开关和浏览器工具协议。

## 4. 现有架构约束

`find_roots → observe_ui → search/expand/inspect → act_ui → successor state` 是公开状态链。`stateId`、`lookId`、`@r` 根引用和 `@e` 元素引用必须继续保持兼容。`ResourceScheduler` 是同一 PID/资源的并发与事务串行化入口，新增行为不得绕过它。

## 5. 实施切片

### Slice 1：窗口引用生命周期稳定性

**行为**

- 每个桌面根记录稳定身份（PID + windowId/nativeWindowRef；没有稳定 ID 时才使用标题和几何作为弱身份）。
- 根记录保存 generation、首次发现和最近确认时间。
- 重新列举窗口时只更新同一稳定身份的记录；稳定身份消失时不再使用标题把它静默绑定到另一窗口。
- 将根失败分成 `closed`、`replaced`、`temporarily_unavailable` 和 `permission_denied`，返回结构化错误码及重新观察指引。
- 窗口引用失效后，最多执行一次受控重新发现；不在失败状态下猜坐标或重复动作。

**接口**

- 新增 `RootReference`/`RootResolution` 生命周期类型和纯解析函数。
- `WindowRefRecord` 增加 `generation` 与 `lastSeenAt`。
- `RootResolutionError` 暴露 `code`、`rootRef`、`expectedIdentity`、`retryable`。

**测试**

- 激活窗口后旧根引用不能继续操作。
- 窗口重建得到新 generation，旧引用返回 `replaced`。
- 无稳定 ID 的窗口只有在唯一标题匹配时才可恢复。
- 不同应用、不同窗口之间不串根。
- 连续 observe 失败不会无限恢复。

### Slice 2：严格动作事务和工具路由

- 强化工具说明，明确桌面操作必须走 `find_roots/observe_ui/act_ui`。
- 为动作上下文提供当前 `stateId`、根身份和动作阶段。
- 在 Fork 中识别并报告桌面自动化绕过，但玉衡负责真正拦截 `osascript`、`System Events`、`cliclick` 等命令。
- `act_ui` 保留批量动作、焦点继承和 `expect`，动作失败时不提交 successor state。

### Slice 3：自绘应用的视觉目标

- 扩展 `pictureOnly` 观察为带 `stateId`、根身份、截图时间和区域的 `visualTarget`。
- 视觉动作必须引用当前视觉观察，不接受跨观察裸坐标重放。
- 明确 `grounding: semantic | visual`，视觉目标失效时返回可诊断错误。
- 继续支持语义 AX 节点；视觉路径只在语义树无法表达目标时使用。

### Slice 4：动作后验证

- 将结果拆为 `delivery: worked | didnt | unknown` 与 `verification: verified | not_verified | failed`。
- `expect`、`wait_for`、OCR/视觉证据和 successor state 都写入 `evidence`。
- 未验证时，工具结果必须明确“已尝试但未验证”，不能声称已完成。
- 对 `setText/typeText` 优先使用观察后的值、文本或应用适配器验证。

### Slice 5：通用动作效果优化

动作发送成功不等于动作产生了目标效果。运行时在同一事务的 successor observation
上运行 `assessActionEffect`，只使用与动作目标有关的证据：

- 带 `ref` 的点击、按键、输入和滚动，可以比较目标节点的状态、值、选择或滚动范围；
- `setText` 必须匹配目标节点的最终 `value`，无关节点变化不能证明写入成功；
- 无 `ref` 的裸坐标不从任意树变化推断成功，只接受 helper 明确的窗口、选择、切换、滚动等证据；
- 根出现、关闭或聚焦属于通用窗口效果，可作为点击或按键的 successor 证据；
- 没有可信证据时仍返回 `not_verified`，并要求模型重新观察。

桌面和浏览器事务共享同一评估器；helper evidence 在批量动作中聚合，结构化写入
`verification.evidence`。该切片不识别 Zed、VS Code、JetBrains 等应用，也不引入应用专属
快捷键、坐标或文档读取器。

**测试**

- 目标节点状态变化、消失、输入最终值和窗口变化可被识别；
- 裸坐标遇到无关 successor 变化不会误判；
- `setText` 最终值不匹配时保持 `not_verified`；
- 桌面与浏览器事务均返回一致的验证状态和证据来源。

## 6. 错误与状态模型

动作状态必须遵守：

```text
observed(stateId, rootIdentity)
  -> executing(stateId)
  -> delivered(outcome)
  -> verified(status)
  -> successor(stateId) | terminal(error)
```

根引用错误不得伪装为普通文本错误。模型可见消息提供简短指引，`details` 提供机器可读的 `code`、`retryable`、`rootRef`、`stateId` 和证据。

## 7. 玉衡适配层边界

- 玉衡维护 `ToolSecurityPolicy`，只阻止桌面自动化绕过，保留普通 Shell。
- 玉衡将项目工作目录和附件上下文注入 Agent；Fork 不读取玉衡数据库。
- Browser Use 与 Computer Use 互斥开关仍由玉衡管理。
- 玉衡 UI 展示结构化验证状态和截图，不依赖错误字符串解析。

## 8. 测试矩阵

覆盖空状态、稳定 windowId、仅 nativeWindowRef、弱身份窗口、窗口关闭、窗口重建、应用切换、权限不足、视觉截图过期、动作发送失败、动作发送成功但验证超时、成功验证、并发同根与并发不同根。Fork 的现有 schema/output/lifecycle/runtime/invariants/platform/linux 脚本作为回归基线。

## 9. 发布与同步

- 每个 Slice 独立变更并记录 release note，不擅自提交玉衡主仓库。
- Fork 使用 `No-Github/pi-computer-use` 作为默认远程；定期从上游合并并解决冲突。
- 玉衡通过固定版本或 commit pin 使用 Fork，升级前运行完整测试和手工 macOS 回归。
- 任一 Slice 回归时可单独回滚适配层，不影响 Browser Use。

## 10. 顺序与验收

按 Slice 1 → 2 → 3 → 4 → 5 实施。每个切片遵循一个行为测试、最小实现、回归测试的 TDD 循环；完成后运行 `npm run typecheck`、相关测试脚本和 `git diff --check`。首个可交付物是 Slice 1 的根引用生命周期模块及其测试。

## 当前进度

- Slice 1：已完成。根引用生命周期、generation、稳定身份失效分类和回归测试已落地。
- Slice 2：已完成。动作事务上下文、阶段转移、后置条件失败的 terminal 结果和工具路由指引已落地。
- Slice 3：已完成。`visualTarget` 证据校验、pictureOnly 自动 visual grounding 和动作 grounding 详情已落地。
- Slice 4：已完成。`act_ui`/浏览器事务现在分离 `delivery` 与 `verification`，记录后置条件和 successor 值证据；无法确认的动作返回 `not_verified`，后置条件失败保持 terminal 且不创建 successor。
- Slice 5：已完成。桌面和浏览器事务共享通用动作效果评估；目标节点变化、最终输入值、helper 选择/切换/滚动证据和窗口变化可用于验证，裸坐标无关变化不会误判。
- 已知基线：`INV-20` 的 Swift CRLF 静态匹配失败，以及缺少预构建 macOS helper；两者均非本次改动引入。
