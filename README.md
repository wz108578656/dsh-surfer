# dsh-surfer

在 [DeepSeek Harness](https://github.com/deepseek-ai) Web 右侧栏用 [Surfer](https://surfer-project.org) 打开波形文件。

点击工作区里的 `.vcd`、`.fst`、`.ghw` 时，这个插件以 `extension` 优先级接管右侧栏标签，优先于内置的文本预览。文件字节由浏览器通过 `workspaceFiles.readBytes` 分块读取：单块仍是 Host 的 2 MiB 上限，但第一块返回文件大小后，后续最多 8 块同时读取，再按偏移拼成一个 `Blob` 交给 Surfer。因此不受 Host 默认的 32 MiB 整文件上限约束。超过 512 MiB 的文件会在第一块返回后拒绝，避免占满浏览器内存。Surfer 本身不打进本仓库：同源 iframe 从 `https://app.surfer-project.org` 加载 `surfer.js`、`surfer_bg.wasm` 和 `integration.js`，就绪后用 `blob:` URL 的 `LoadUrl` 把波形送进去。

仓库布局和 [dsh-pele](https://github.com/hesheng01/dsh-pele) 一样：根目录只放仓库脚本，可安装的 bundle 在 `plugin/`。

## 安装

在 Harness 里用 `plugin_manager` 的 `install_bundle`，target 指向本仓库的 `plugin` 目录；或在已经登录的 profile 上：

```bash
dsh plugin --profile web add /absolute/path/to/dsh-surfer/plugin
```

安装后刷新一次 Web 页面，让 `client.js` 进入页面。然后在文件树里打开一个波形文件。

浏览器必须能访问 `https://app.surfer-project.org`（`surfer.js`、约 15 MB 的 `surfer_bg.wasm`、`integration.js`）。严格 CSP 还需要允许该源的 `script-src` / `connect-src`，以及 `'wasm-unsafe-eval'`。

## 限制

- 只打开当前会话工作区里的文件（`dsh-resource://file/session/...`）。绝对路径地址会被拒绝。
- 已经打开的波形标签会保持挂载。切换右侧栏标签、切换会话、收起侧栏或拖成浮动窗口时，Surfer 不会重新读取文件或重新加载。关闭标签后才会释放。
- 超过 512 MiB 的文件不会读入侧栏。更小的文件会整份留在浏览器内存里，很大的 VCD 仍然可能让标签页变慢。
- 不调用本机的 `surfer` 二进制，也不注册 Surfer 的 `sw.js`。
- 波形能否被解析取决于当前托管的 Surfer WASM。加载失败时侧栏给出重试，也可以改去 [Surfer 网站](https://app.surfer-project.org) 打开。

## 许可

本仓库代码为 MIT。运行时加载的 Surfer 是独立项目，许可证为 EUPL-1.2，见 <https://gitlab.com/surfer-project/surfer>。
