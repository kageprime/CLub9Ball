// 测试辅助：尝试加载 Rapier。没安装（如离线环境）时返回 null，依赖物理引擎的用例会被跳过。
let cached;
export async function loadRapier() {
  if (cached !== undefined) return cached;
  try {
    const mod = await import('@dimforge/rapier3d-compat');
    const RAPIER = mod.default ?? mod;
    await RAPIER.init();
    cached = RAPIER;
  } catch (e) {
    cached = null;
  }
  return cached;
}
