import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { PassThrough } from "stream";

const USER_AGENT = "vbox-app/1.0";

// 添加日志控制
const IGNORED_METHODS = ['resources/list', 'prompts/list'];

function shouldLogMessage(method: string): boolean {
  return !IGNORED_METHODS.includes(method);
}

// 创建服务器实例
const server = new McpServer({
  name: "vbox",
  version: "1.0.0",
  logLevel: "warn", // 修改日志级别为 warn
  onMessage: (direction: "client" | "server", message: any) => {
    // 只记录非忽略方法的消息
    if (message.method && !shouldLogMessage(message.method)) {
      return;
    }
    // 只记录错误和警告
    if (message.error || message.level === "warn" || message.level === "error") {
      console.error(`[${direction}] ${JSON.stringify(message)}`);
    }
  }
});

// 全局状态：记录当前执行环境
interface ExecutionContext {
  type: "local" | "pod";
  podName?: string;
  namespace?: string;
  containerId?: string;
  terminalSession?: {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    ws?: any;
  };
}

let currentExecutionContext: ExecutionContext = {
  type: "local"
};

// Docker 相关功能
server.tool(
  "docker_list_containers",
  {},
  async () => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync('docker ps -a --format "{{json .}}"');
      
      if (stderr) {
        console.error(stderr);
      }

      // 解析 JSON 输出
      const containers = stdout.trim().split('\n').map(line => JSON.parse(line));
      
      return {
        content: [{ type: "text", text: JSON.stringify(containers, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

server.tool(
  "docker_pull_image",
  { imageName: z.string().describe("Docker 镜像名称") },
  async ({ imageName }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync(`docker pull ${imageName}`);
      console.log(stdout);
      
      if (stderr) {
        console.error(stderr);
      }

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            message: `Successfully pulled image "${imageName}"`,
            output: stdout,
            errors: stderr
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

server.tool(
  "docker_create_container",
  {
    imageName: z.string().describe("Docker 镜像名称"),
    containerName: z.string().describe("容器名称"),
    command: z.array(z.string()).optional().describe("要运行的命令"),
  },
  async ({ imageName, containerName, command }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      let cmd = `docker create --name ${containerName} ${imageName}`;
      if (command && command.length > 0) {
        cmd += ` ${command.join(' ')}`;
      }
      
      const { stdout, stderr } = await execAsync(cmd);
      console.log(stdout);
      
      if (stderr) {
        console.error(stderr);
      }

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            message: `Successfully created container "${containerName}"`,
            containerId: stdout.trim(),
            errors: stderr
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 创建 Kubernetes 部署
server.tool(
  "k8s_create_deployment",
  {
    name: z.string().describe("Deployment 名称"),
    image: z.string().describe("容器镜像"),
    namespace: z.string().default("default").describe("Kubernetes 命名空间"),
    replicas: z.number().default(1).describe("副本数量"),
    containerPort: z.number().optional().describe("容器端口"),
    env: z.array(z.object({
      name: z.string(),
      value: z.string()
    })).optional().describe("环境变量"),
    resources: z.object({
      limits: z.object({
        cpu: z.string().optional(),
        memory: z.string().optional()
      }).optional(),
      requests: z.object({
        cpu: z.string().optional(),
        memory: z.string().optional()
      }).optional()
    }).optional().describe("资源限制")
  },
  async ({ name, image, namespace, replicas, containerPort, env, resources }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      let cmd = `kubectl create deployment ${name} --image=${image} -n ${namespace} --replicas=${replicas}`;
      
      if (containerPort) {
        cmd += ` --port=${containerPort}`;
      }
      
      const { stdout, stderr } = await execAsync(cmd);
      console.log(stdout);
      
      if (stderr) {
        console.error(stderr);
      }

      // 如果有环境变量或资源限制，需要额外的 patch 命令
      if (env || resources) {
        const patch: any = {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: name,
                  env: env,
                  resources: resources
                }]
              }
            }
          }
        };
        
        const patchCmd = `kubectl patch deployment ${name} -n ${namespace} --type=merge -p '${JSON.stringify(patch)}'`;
        const { stdout: patchStdout, stderr: patchStderr } = await execAsync(patchCmd);
        
        console.log(patchStdout);
        if (patchStderr) {
          console.error(patchStderr);
        }
      }

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            message: `Successfully created deployment "${name}"`,
            output: stdout,
            errors: stderr
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 进入 Pod 执行命令
server.tool(
  "k8s_exec_pod",
  {
    podName: z.string().describe("Pod 名称"),
    namespace: z.string().default("default").describe("Kubernetes 命名空间"),
    container: z.string().optional().describe("容器名称（如果 Pod 有多个容器）"),
    command: z.array(z.string()).describe("要执行的命令"),
  },
  async ({ podName, namespace, container, command }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      let cmd = `kubectl exec ${podName} -n ${namespace}`;
      
      if (container) {
        cmd += ` -c ${container}`;
      }
      
      cmd += ` -- ${command.join(' ')}`;
      
      const { stdout, stderr } = await execAsync(cmd);
      console.log(stdout);
      
      if (stderr) {
        console.error(stderr);
      }

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            output: stdout,
            errors: stderr
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 进入 Pod 的交互式 shell
server.tool(
  "k8s_enter_pod",
  {
    podName: z.string().describe("Pod 名称"),
    namespace: z.string().default("default").describe("Kubernetes 命名空间"),
    container: z.string().optional().describe("容器名称（如果 Pod 有多个容器）"),
  },
  async ({ podName, namespace, container }) => {
    try {
      const { spawn } = await import('child_process');
      
      let args = ['exec', '-it', podName, '-n', namespace];
      
      if (container) {
        args.push('-c', container);
      }
      
      args.push('--', 'sh');
      
      const kubectl = spawn('kubectl', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      
      kubectl.stdout.pipe(stdout);
      kubectl.stderr.pipe(stderr);
      stdin.pipe(kubectl.stdin);
      
      // 设置流的事件处理
      stdout.on("data", (data) => {
        console.log("Pod output:", data.toString());
      });

      stderr.on("data", (data) => {
        console.error("Pod error:", data.toString());
      });

      // 更新执行环境状态
      currentExecutionContext = {
        type: "pod",
        podName,
        namespace,
        containerId: container,
        terminalSession: {
          stdout,
          stderr,
          stdin,
          ws: kubectl
        }
      };

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            message: `已进入 Pod ${podName} 的交互式 shell`,
            context: {
              type: "pod",
              podName,
              namespace,
              container
            }
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 退出 Pod 的执行环境
server.tool(
  "k8s_exit_pod",
  {},
  async () => {
    try {
      if (currentExecutionContext.terminalSession) {
        // 关闭所有流
        currentExecutionContext.terminalSession.stdin.end();
        currentExecutionContext.terminalSession.stdout.end();
        currentExecutionContext.terminalSession.stderr.end();
        
        if (currentExecutionContext.terminalSession.ws) {
          currentExecutionContext.terminalSession.ws.close();
        }
      }

      currentExecutionContext = {
        type: "local"
      };

      return {
        content: [{ type: "text", text: "已退出 Pod 执行环境，返回本地环境" }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 获取当前执行环境
server.tool(
  "get_execution_context",
  {},
  async () => {
    return {
      content: [{ type: "text", text: JSON.stringify(currentExecutionContext, null, 2) }]
    };
  }
);

// 在当前环境执行命令
server.tool(
  "execute_command",
  {
    command: z.array(z.string()).describe("要执行的命令"),
  },
  async ({ command }) => {
    try {
      if (currentExecutionContext.type === "local") {
        // 在本地执行命令
        const { spawn } = await import("child_process");
        const process = spawn(command[0], command.slice(1));
        
        return new Promise((resolve) => {
          let output = "";
          
          process.stdout.on("data", (data: Buffer) => {
            output += data.toString();
            // 实时输出
            console.log(data.toString());
          });
          
          process.stderr.on("data", (data: Buffer) => {
            output += data.toString();
            // 实时输出
            console.error(data.toString());
          });
          
          process.on("close", (code: number) => {
            resolve({
              content: [{ 
                type: "text", 
                text: JSON.stringify({
                  output,
                  exitCode: code
                }, null, 2)
              }]
            });
          });
        });
      } else if (currentExecutionContext.terminalSession) {
        // 在 Pod 中执行命令
        const { stdin, stdout } = currentExecutionContext.terminalSession;
        
        return new Promise((resolve) => {
          let output = "";
          const commandStr = command.join(" ") + "\n";
          
          // 设置一次性数据处理器
          const dataHandler = (data: Buffer) => {
            const text = data.toString();
            output += text;
            // 实时输出
            console.log(text);
          };
          
          stdout.on("data", dataHandler);
          
          // 发送命令到 stdin
          stdin.write(commandStr);
          
          // 等待一段时间后返回结果
          setTimeout(() => {
            stdout.removeListener("data", dataHandler);
            resolve({
              content: [{ 
                type: "text", 
                text: JSON.stringify({
                  output,
                  command: commandStr.trim()
                }, null, 2)
              }]
            });
          }, 1000); // 等待 1 秒以收集输出
        });
      } else {
        throw new Error("No active terminal session");
      }
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 创建 Kubernetes 集群
server.tool(
  "k8s_create_cluster",
  {
    name: z.string().describe("集群名称"),
    version: z.string().optional().describe("Kubernetes 版本"),
    config: z.string().optional().describe("Kubernetes 配置文件路径"),
    workers: z.number().optional().default(0).describe("工作节点数量")
  },
  async ({ name, version, config, workers }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      // 使用 kubectl 创建集群
      let command = `kubectl create cluster`;
      
      if (name) {
        command += ` --name ${name}`;
      }
      
      if (version) {
        command += ` --kubernetes-version=${version}`;
      }
      
      if (config) {
        command += ` --config ${config}`;
      }
      
      if (workers && workers > 0) {
        command += ` --nodes=${workers}`;
      }

      // 执行命令
      const { stdout, stderr } = await execAsync(command);
      console.log(stdout);
      
      if (stderr) {
        console.error(stderr);
      }

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            message: `成功创建集群 "${name}"`,
            output: stdout,
            errors: stderr
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            error: error.message,
            details: "请确保已安装 kubectl 并且在 PATH 中"
          }, null, 2) 
        }]
      };
    }
  }
);

// 删除 Kubernetes 资源
server.tool(
  "k8s_delete",
  {
    resource: z.string().describe("资源类型，如 pod, deployment, service 等"),
    name: z.string().describe("资源名称"),
    namespace: z.string().default("default").describe("命名空间"),
    force: z.boolean().optional().describe("是否强制删除")
  },
  async ({ resource, name, namespace, force }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      let cmd = `kubectl delete ${resource} ${name} -n ${namespace}`;
      if (force) {
        cmd += ' --force --grace-period=0';
      }
      
      const { stdout, stderr } = await execAsync(cmd);
      console.log(stdout);
      
      if (stderr) {
        console.error(stderr);
      }

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            message: `Successfully deleted ${resource} "${name}"`,
            output: stdout,
            errors: stderr
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 查看 Pod 日志
server.tool(
  "k8s_logs",
  {
    podName: z.string().describe("Pod 名称"),
    namespace: z.string().default("default").describe("命名空间"),
    container: z.string().optional().describe("容器名称"),
    tail: z.number().optional().describe("要显示的最后几行日志"),
    follow: z.boolean().optional().describe("是否持续查看日志")
  },
  async ({ podName, namespace, container, tail, follow }) => {
    try {
      const { spawn } = await import('child_process');
      
      let args = ['logs', podName, '-n', namespace];
      
      if (container) {
        args.push('-c', container);
      }
      
      if (tail) {
        args.push('--tail', tail.toString());
      }
      
      if (follow) {
        args.push('-f');
      }
      
      const kubectl = spawn('kubectl', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      return new Promise((resolve) => {
        let output = '';
        
        kubectl.stdout.on('data', (data) => {
          const text = data.toString();
          output += text;
          console.log(text);
        });
        
        kubectl.stderr.on('data', (data) => {
          const text = data.toString();
          output += text;
          console.error(text);
        });
        
        kubectl.on('close', (code) => {
          if (!follow) {
            resolve({
              content: [{ 
                type: "text", 
                text: JSON.stringify({
                  status: "success",
                  output,
                  exitCode: code
                }, null, 2)
              }]
            });
          }
        });
        
        // 如果是持续查看日志，立即返回成功状态
        if (follow) {
          resolve({
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                status: "success",
                message: "Started following logs",
                podName,
                namespace,
                container
              }, null, 2)
            }]
          });
        }
      });
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 端口转发
server.tool(
  "k8s_port_forward",
  {
    resource: z.string().describe("资源类型和名称，如 pod/my-pod 或 service/my-service"),
    namespace: z.string().default("default").describe("命名空间"),
    localPort: z.number().describe("本地端口"),
    remotePort: z.number().describe("远程端口")
  },
  async ({ resource, namespace, localPort, remotePort }) => {
    try {
      const { spawn } = await import('child_process');
      
      const args = [
        'port-forward',
        '-n',
        namespace,
        resource,
        `${localPort}:${remotePort}`
      ];
      
      const kubectl = spawn('kubectl', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      return new Promise((resolve) => {
        kubectl.stdout.on('data', (data) => {
          console.log(data.toString());
        });
        
        kubectl.stderr.on('data', (data) => {
          console.error(data.toString());
        });
        
        // 等待端口转发建立
        setTimeout(() => {
          resolve({
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                status: "success",
                message: `Port forwarding established`,
                details: {
                  resource,
                  namespace,
                  localPort,
                  remotePort
                }
              }, null, 2)
            }]
          });
        }, 1000);
      });
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 应用 YAML 配置
server.tool(
  "k8s_apply",
  {
    yamlPath: z.string().describe("YAML 文件路径"),
    namespace: z.string().default("default").describe("命名空间")
  },
  async ({ yamlPath, namespace }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync(`kubectl apply -f ${yamlPath} -n ${namespace}`);
      console.log(stdout);
      
      if (stderr) {
        console.error(stderr);
      }

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            message: "Successfully applied YAML configuration",
            output: stdout,
            errors: stderr
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 获取资源详情
server.tool(
  "k8s_describe",
  {
    resource: z.string().describe("资源类型，如 pod, deployment, service 等"),
    name: z.string().describe("资源名称"),
    namespace: z.string().default("default").describe("命名空间")
  },
  async ({ resource, name, namespace }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync(`kubectl describe ${resource} ${name} -n ${namespace}`);
      console.log(stdout);
      
      if (stderr) {
        console.error(stderr);
      }

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            output: stdout,
            errors: stderr
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 扩缩容
server.tool(
  "k8s_scale",
  {
    resource: z.string().describe("资源类型，如 deployment, statefulset"),
    name: z.string().describe("资源名称"),
    replicas: z.number().describe("副本数量"),
    namespace: z.string().default("default").describe("命名空间")
  },
  async ({ resource, name, replicas, namespace }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync(
        `kubectl scale ${resource} ${name} --replicas=${replicas} -n ${namespace}`
      );
      console.log(stdout);
      
      if (stderr) {
        console.error(stderr);
      }

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            message: `Scaled ${resource} "${name}" to ${replicas} replicas`,
            output: stdout,
            errors: stderr
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 列出所有 Pod
server.tool(
  "k8s_list_pods",
  {
    namespace: z.string().default("default").describe("命名空间"),
    selector: z.string().optional().describe("标签选择器"),
    all_namespaces: z.boolean().optional().describe("是否查看所有命名空间")
  },
  async ({ namespace, selector, all_namespaces }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      let cmd = 'kubectl get pods';
      if (all_namespaces) {
        cmd += ' --all-namespaces';
      } else {
        cmd += ` -n ${namespace}`;
      }
      
      if (selector) {
        cmd += ` -l ${selector}`;
      }
      
      cmd += ' -o json';
      
      const { stdout, stderr } = await execAsync(cmd);
      
      if (stderr) {
        console.error(stderr);
      }

      const pods = JSON.parse(stdout);
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            pods: pods.items.map((pod: any) => ({
              name: pod.metadata.name,
              namespace: pod.metadata.namespace,
              status: pod.status.phase,
              ip: pod.status.podIP,
              node: pod.spec.nodeName,
              age: pod.metadata.creationTimestamp
            })),
            total: pods.items.length
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 列出所有 Deployment
server.tool(
  "k8s_list_deployments",
  {
    namespace: z.string().default("default").describe("命名空间"),
    selector: z.string().optional().describe("标签选择器"),
    all_namespaces: z.boolean().optional().describe("是否查看所有命名空间")
  },
  async ({ namespace, selector, all_namespaces }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      let cmd = 'kubectl get deployments';
      if (all_namespaces) {
        cmd += ' --all-namespaces';
      } else {
        cmd += ` -n ${namespace}`;
      }
      
      if (selector) {
        cmd += ` -l ${selector}`;
      }
      
      cmd += ' -o json';
      
      const { stdout, stderr } = await execAsync(cmd);
      
      if (stderr) {
        console.error(stderr);
      }

      const deployments = JSON.parse(stdout);
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            deployments: deployments.items.map((deployment: any) => ({
              name: deployment.metadata.name,
              namespace: deployment.metadata.namespace,
              replicas: {
                desired: deployment.spec.replicas,
                available: deployment.status.availableReplicas || 0,
                ready: deployment.status.readyReplicas || 0
              },
              image: deployment.spec.template.spec.containers[0].image,
              age: deployment.metadata.creationTimestamp
            })),
            total: deployments.items.length
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 列出所有 Service
server.tool(
  "k8s_list_services",
  {
    namespace: z.string().default("default").describe("命名空间"),
    selector: z.string().optional().describe("标签选择器"),
    all_namespaces: z.boolean().optional().describe("是否查看所有命名空间")
  },
  async ({ namespace, selector, all_namespaces }) => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      let cmd = 'kubectl get services';
      if (all_namespaces) {
        cmd += ' --all-namespaces';
      } else {
        cmd += ` -n ${namespace}`;
      }
      
      if (selector) {
        cmd += ` -l ${selector}`;
      }
      
      cmd += ' -o json';
      
      const { stdout, stderr } = await execAsync(cmd);
      
      if (stderr) {
        console.error(stderr);
      }

      const services = JSON.parse(stdout);
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            services: services.items.map((service: any) => ({
              name: service.metadata.name,
              namespace: service.metadata.namespace,
              type: service.spec.type,
              clusterIP: service.spec.clusterIP,
              externalIP: service.spec.externalIPs || [],
              ports: service.spec.ports.map((port: any) => ({
                port: port.port,
                targetPort: port.targetPort,
                protocol: port.protocol,
                nodePort: port.nodePort
              })),
              age: service.metadata.creationTimestamp
            })),
            total: services.items.length
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 列出所有命名空间
server.tool(
  "k8s_list_namespaces",
  {},
  async () => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync('kubectl get namespaces -o json');
      
      if (stderr) {
        console.error(stderr);
      }

      const namespaces = JSON.parse(stdout);
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            namespaces: namespaces.items.map((ns: any) => ({
              name: ns.metadata.name,
              status: ns.status.phase,
              age: ns.metadata.creationTimestamp
            })),
            total: namespaces.items.length
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 列出所有节点
server.tool(
  "k8s_list_nodes",
  {},
  async () => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync('kubectl get nodes -o json');
      
      if (stderr) {
        console.error(stderr);
      }

      const nodes = JSON.parse(stdout);
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            nodes: nodes.items.map((node: any) => ({
              name: node.metadata.name,
              status: node.status.conditions.find((c: any) => c.type === 'Ready')?.status || 'Unknown',
              roles: Object.keys(node.metadata.labels || {})
                .filter(label => label.startsWith('node-role.kubernetes.io/'))
                .map(label => label.replace('node-role.kubernetes.io/', '')),
              version: node.status.nodeInfo.kubeletVersion,
              os: node.status.nodeInfo.osImage,
              kernel: node.status.nodeInfo.kernelVersion,
              age: node.metadata.creationTimestamp
            })),
            total: nodes.items.length
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
      };
    }
  }
);

// 列出所有集群
server.tool(
  "k8s_list_clusters",
  {},
  async () => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      // 尝试使用不同的工具获取集群信息
      let clusters = [];
      
      // 1. 尝试从 kubeconfig 获取集群信息
      try {
        const { stdout: configOutput } = await execAsync('kubectl config get-contexts -o json');
        const contexts = JSON.parse(configOutput);
        clusters.push(...contexts.map((ctx: any) => ({
          name: ctx.name,
          cluster: ctx.context.cluster,
          user: ctx.context.user,
          isCurrent: ctx.current === '*',
          source: 'kubeconfig'
        })));
      } catch (error) {
        console.error('Error getting kubeconfig contexts:', error);
      }
      
      // 2. 尝试获取 kind 集群
      try {
        const { stdout: kindOutput } = await execAsync('kind get clusters');
        const kindClusters = kindOutput.trim().split('\n').filter(Boolean);
        clusters.push(...kindClusters.map(name => ({
          name,
          type: 'kind',
          source: 'kind'
        })));
      } catch (error) {
        // kind 可能未安装，忽略错误
      }
      
      // 3. 尝试获取 minikube 集群
      try {
        const { stdout: minikubeOutput } = await execAsync('minikube profile list -o json');
        const minikubeProfiles = JSON.parse(minikubeOutput);
        clusters.push(...minikubeProfiles.valid.map((profile: any) => ({
          name: profile.Name,
          type: 'minikube',
          status: profile.Status,
          version: profile.Config.KubernetesVersion,
          source: 'minikube'
        })));
      } catch (error) {
        // minikube 可能未安装，忽略错误
      }
      
      // 4. 尝试获取 Docker Desktop 集群
      try {
        const { stdout: dockerOutput } = await execAsync('docker context list --format json');
        const dockerContexts = dockerOutput.trim().split('\n').map(line => JSON.parse(line));
        const k8sContexts = dockerContexts.filter((ctx: any) => ctx.Type === 'kubernetes');
        clusters.push(...k8sContexts.map((ctx: any) => ({
          name: ctx.Name,
          type: 'docker-desktop',
          source: 'docker'
        })));
      } catch (error) {
        // Docker Desktop 可能未安装，忽略错误
      }

      // 移除重复的集群
      const uniqueClusters = Array.from(new Map(clusters.map(item =>
        [item.name, item]
      )).values());

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "success",
            clusters: uniqueClusters,
            total: uniqueClusters.length,
            sources: ['kubeconfig', 'kind', 'minikube', 'docker-desktop']
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            error: error.message,
            details: "获取集群列表失败"
          }, null, 2)
        }]
      };
    }
  }
);

// 启动服务器
async function main() {
    try {
        console.error("Starting VBox MCP Server...");
        
        const transport = new StdioServerTransport();
        console.error("Created StdioServerTransport");
        
        await server.connect(transport);
        console.error("Connected to transport");
        
        console.error("VBox MCP Server running on stdio");
        
        // 设置进程事件处理器
        process.on('SIGTERM', () => {
            console.error('Received SIGTERM signal');
            console.error('Received SIGTERM, shutting down...');
            process.exit(0);
        });
        
        process.on('uncaughtException', (error) => {
            console.error('Uncaught exception:', error);
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });
        
        // 保持进程运行
        await new Promise(() => {
            console.error("Server is now running indefinitely");
        });
    } catch (error) {
        console.error("Fatal error in main():", error);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});

