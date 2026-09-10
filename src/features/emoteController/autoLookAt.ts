import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import { VRMLookAtSmoother } from "@/lib/VRMLookAtSmootherLoaderPlugin/VRMLookAtSmoother";
/**
 * 目線を制御するクラス
 *
 * サッケードはVRMLookAtSmootherの中でやっているので、
 * より目線を大きく動かしたい場合はここに実装する。
 *
 * 目線のターゲットは2種類:
 * - `_lookAtTarget`: カメラに親子付けした「カメラ目線」用（デフォルトのフォールバック）
 * - `_cursorTarget`: ポインタ追従用のワールド空間ターゲット。座標は viewer 側が毎フレーム
 *   更新し、Smoother の `userTarget` として使われる（config: `lookat_cursor`）。
 */
export class AutoLookAt {
  private _lookAtTarget: THREE.Object3D;
  private _cursorTarget: THREE.Object3D;
  constructor(vrm: VRM, camera: THREE.Object3D) {
    this._lookAtTarget = new THREE.Object3D();
    camera.add(this._lookAtTarget);

    // ポインタ追従用ターゲット。カメラには親子付けせず、ワールド座標を直接更新する。
    this._cursorTarget = new THREE.Object3D();

    if (vrm.lookAt) {
      vrm.lookAt.target = this._lookAtTarget;

      // Smoother の場合は、ポインタ追従ターゲットを登録しておく。
      // （viewer が `lookAtWorldPosition()` を呼ぶとこのオブジェクトが動く）
      if (vrm.lookAt instanceof VRMLookAtSmoother) {
        vrm.lookAt.setCursorTarget(this._cursorTarget);
      }
    }
  }

  /** ポインタ追従に使うワールド空間ターゲット */
  public get cursorTarget(): THREE.Object3D {
    return this._cursorTarget;
  }
}
