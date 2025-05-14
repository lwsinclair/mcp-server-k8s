[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/wan-hao-mcp-server-k8s-badge.png)](https://mseep.ai/app/wan-hao-mcp-server-k8s)

# MCP-Server VBox

MCP-Server VBox 是一个基于 Model Context Protocol (MCP) 的服务器实现，用于管理和操作 Docker 容器和 Kubernetes 集群。该工具提供了一个统一的接口，让您可以通过 Claude Desktop 方便地执行容器和 Pod 相关的操作。

## 功能特点

### Docker 操作
- 列出所有容器（`docker_list_containers`）
- 拉取 Docker 镜像（`docker_pull_image`）
- 创建新容器（`docker_create_container`）

### Kubernetes 操作
- 列出指定命名空间的 Pod（`k8s_list_pods`）
- 创建 Deployment（`k8s_create_deployment`）
- 在 Pod 中执行命令（`k8s_exec_pod`）
- 进入 Pod 的交互式 shell（`k8s_enter_pod`）
- 退出 Pod 的执行环境（`k8s_exit_pod`）

### 执行环境管理
- 获取当前执行环境（`get_execution_context`）
- 在当前环境执行命令（`execute_command`）
- 支持本地和 Pod 两种执行环境
- 实时命令执行和输出

## 系统要求

- Node.js >= 14.0.0
- Docker
- Kubernetes 集群配置（~/.kube/config）
- Claude Desktop

## 安装和配置

1. **安装依赖**
```bash
npm install
```

2. **构建项目**
```bash
npm run build
```

3. **配置 Claude Desktop**

在 `~/Library/Application Support/Claude/claude_desktop_config.json` 中添加以下配置：

```json
{
    "mcpServers": {
        "vbox": {
            "command": "node",
            "args": [
                "/path/to/your/vbox/build/index.js"
            ]
        }
    }
}
```

注意：请将 `/path/to/your/vbox` 替换为实际的项目路径。

## 调试

如果需要调试，可以在 Claude Desktop 配置中添加调试选项：

```json
{
    "mcpServers": {
        "vbox": {
            "command": "node",
            "args": [
                "--inspect",
                "/path/to/your/vbox/build/index.js"
            ],
            "debug": true
        }
    }
}
```

日志文件位置：
- MCP 服务器日志：`~/Library/Logs/Claude/mcp-server-vbox.log`
- Claude Desktop 日志：`~/Library/Logs/Claude/mcp.log`

## 注意事项

1. 确保 Docker 守护进程正在运行
2. 确保有正确的 Kubernetes 配置文件（默认位置：~/.kube/config）
3. 确保有适当的集群访问权限
4. 在使用 Pod 相关功能时，确保指定正确的命名空间和 Pod 名称

## 许可证

MIT License

## 作者

[Your Name]

## 更新日志

### 1.0.0
- 初始版本发布
- 实现基本的 Docker 和 Kubernetes 操作功能
- 添加交互式 shell 支持 