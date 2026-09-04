/**
 * Agent Interface — capability boundary(A-002,最小实现)。
 *
 * 概念能力:
 *   graph.read / graph.write / graph.assert / graph.screenshot / test.fixture
 *
 * 当前只有 `test.fixture`(reset / seedFixture)需要独立开关:
 * - Bridge enabled ≠ test capabilities enabled;
 * - 默认关闭,仅当宿主显式开启(如 NODEFLOW_AGENT_TEST_CMDS=1 并由主进程下发)后可用;
 * - 未来 MCP 应对应抽象 capability,不感知具体环境变量。
 *
 * 本模块为运行时内存开关,与传输层无关,便于未来任何宿主复用。
 */

let testCommandsEnabled = false;

/** 显式开启/关闭 test-only commands(reset / seedFixture)。 */
export function setAgentTestCommandsEnabled(enabled: boolean): void {
  testCommandsEnabled = enabled;
}

export function isAgentTestCommandsEnabled(): boolean {
  return testCommandsEnabled;
}

export const TEST_ONLY_COMMANDS: ReadonlySet<string> = new Set(['reset', 'seedFixture']);
