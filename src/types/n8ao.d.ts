declare module 'n8ao' {
  import type { Camera, Scene, Color } from 'three';
  import { Pass } from 'postprocessing';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number; distanceFalloff: number; intensity: number; halfRes: boolean;
      aoSamples: number; denoiseSamples: number; denoiseRadius: number; gammaCorrection: boolean;
      screenSpaceRadius: boolean; depthAwareUpsampling: boolean; color: Color; transparencyAware: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(w: number, h: number): void;
  }
}
