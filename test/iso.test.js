import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ISO, computeIsoCam, isoBasis } from '../src/cameras.js';

// 房间尺寸与 src/world.js 的 ROOM 保持一致（俯视导航取景需要装下整间房）
const ROOM = { x0: -4.2, x1: 4.2, z0: -3.0, z1: 3.0 };
const ROOM_W = ROOM.x1 - ROOM.x0, ROOM_D = ROOM.z1 - ROOM.z0;
const HALF_DIAG = (ROOM_W + ROOM_D) / 2 / Math.SQRT2;   // 45° 等距下房间对角的一半

// 按 world._updateIsoFrustum 的规则搭一台真实正交相机，用于投影验证
function isoFrame(x, z, aspect) {
  const c = computeIsoCam({ x, z, aspect });
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  cam.position.copy(c.pos);
  cam.lookAt(c.look);
  const v = c.view;
  cam.left = -v * aspect; cam.right = v * aspect; cam.top = v; cam.bottom = -v;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}

describe('俯视导航相机（等距）', () => {
  it('W 沿屏幕上方（远离相机）移动，D 沿屏幕右方，且正交归一', () => {
    const b = isoBasis();
    const c = Math.cos(ISO.yaw), s = Math.sin(ISO.yaw);
    // 屏幕上方 = 相机地面朝向的相反方向（远离相机）
    assert.ok(b.fx * c + b.fz * s < -0.99, `W 应远离相机: (${b.fx},${b.fz})·(${c},${s})`);
    // 屏幕右方 = 前方顺时针 90°
    assert.ok(Math.abs(b.fx * b.rx + b.fz * b.rz) < 1e-9, '前/右应正交');
    assert.ok(Math.abs(Math.hypot(b.fx, b.fz) - 1) < 1e-9, '前方应为单位向量');
    assert.ok(Math.abs(Math.hypot(b.rx, b.rz) - 1) < 1e-9, '右方应为单位向量');
    // 右 = (s, -c)（与相机右方一致，保证 D 在屏幕上向右）
    assert.ok(Math.abs(b.rx - s) < 1e-9 && Math.abs(b.rz + c) < 1e-9, `right=(${b.rx},${b.rz})`);
  });

  it('相机在房间上方俯视中心；跟随平移被夹紧在房间构图内', () => {
    const c = computeIsoCam({ x: 0, z: 0 });
    assert.ok(c.pos.y > 0, '相机在上方');
    // 相机站在 look 的 (cos yaw, sin yaw) 方向一侧（与 ISO.yaw 一致，例如 -x/+z 上方）
    assert.ok((c.pos.x - c.look.x) * Math.cos(ISO.yaw) > 0, '相机 x 在 yaw 一侧');
    assert.ok((c.pos.z - c.look.z) * Math.sin(ISO.yaw) > 0, '相机 z 在 yaw 一侧');
    assert.equal(c.look.x, 0); assert.equal(c.look.z, 0);
    const far = computeIsoCam({ x: 99, z: -99 });
    assert.equal(far.look.x, ISO.pan);
    assert.equal(far.look.z, -ISO.pan);
  });

  it('16:9 时整间房（含对角）都在视锥内', () => {
    const aspect = 16 / 9;
    const c = computeIsoCam({ aspect });
    const halfW = c.view * aspect;
    const needH = HALF_DIAG * Math.sin(ISO.pitch);      // 俯角压缩后的纵向需求
    assert.ok(halfW >= HALF_DIAG, `halfW ${halfW} < ${HALF_DIAG}`);
    assert.ok(c.view >= needH, `view ${c.view} < ${needH}`);
  });

  it('竖屏 / 窄屏自动拉远，水平方向仍完整装得下', () => {
    const wide = computeIsoCam({ aspect: 16 / 9 });
    for (const aspect of [1.0, 0.75, 0.5]) {
      const c = computeIsoCam({ aspect });
      assert.ok(c.view > wide.view, `aspect ${aspect} 应比横屏拉远`);
      assert.ok(c.view * aspect >= HALF_DIAG - 1e-9, `aspect ${aspect} 水平装不下整间房`);
    }
  });

  it('真实投影：跟随到任意位置时，地面四角都在视锥内', () => {
    const spots = [[0, 0], [-3.9, 2.5], [3.9, -1.8], [3.9, 2.5], [-3.9, -1.8]];
    for (const aspect of [16 / 9, 1.6, 4 / 3, 1.0, 0.75, 0.5]) {
      for (const [px, pz] of spots) {
        const cam = isoFrame(px, pz, aspect);
        for (const x of [ROOM.x0, ROOM.x1]) for (const z of [ROOM.z0, ROOM.z1]) {
          const p = new THREE.Vector3(x, 0, z).project(cam);
          assert.ok(Math.abs(p.x) <= 1.02 && Math.abs(p.y) <= 1.02,
            `aspect=${aspect} player=(${px},${pz}) corner=(${x},${z}) → (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
        }
      }
    }
  });

  it('真实投影：各处台位标记（点击目标）始终在视锥内', () => {
    // world.markerMap 的台位中心：台球桌 + 六个小游戏/酒吧
    const marks = [[0, 0], [1.82, 1.6], [2.85, -0.45], [-2.85, -0.45], [-2.8, 1.8], [-1.6, -2.18], [-0.6, -2.18]];
    for (const aspect of [16 / 9, 1.0, 0.6]) {
      for (const [px, pz] of [[0, 0], [-3.9, 2.5], [3.9, 2.5]]) {
        const cam = isoFrame(px, pz, aspect);
        for (const [x, z] of marks) for (const y of [0, 2.4]) {
          const p = new THREE.Vector3(x, y, z).project(cam);
          assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
            `aspect=${aspect} player=(${px},${pz}) mark=(${x},${z},${y}) → (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
        }
      }
    }
  });
});
