/**
 * TextMaskRenderer - GPU-based adaptive text mask generation
 * Creates intelligent overlay masks for text regions based on ocean brightness
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4 } from '../utils/math';

export interface TextRegionConfig {
  elementId: string;                    // HTML element ID for the text region
  position: [number, number];           // Screen position in normalized coordinates (0-1)
  size: [number, number];               // Size in normalized coordinates (0-1)
  adaptationStrength: number;           // How strongly to adapt (0.0-1.0)
  contrastThreshold: number;            // Brightness threshold for switching (0.0-1.0)
  transitionSmoothness: number;         // How smooth the transition is (0.0-1.0)
}

export interface TextMaskConfig {
  lightTextColor: [number, number, number, number];  // RGBA for light text
  darkTextColor: [number, number, number, number];   // RGBA for dark text
  shadowIntensity: number;                            // Text shadow strength
  gradientSamples: number;                            // Number of samples for gradient generation
}

export class TextMaskRenderer {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private textMaskProgram: ShaderProgram | null = null;

  // Geometry for rendering text masks
  private quadGeometry: GeometryData;
  private bufferManager: BufferManager;

  // Framebuffer for mask generation
  private maskFramebuffer: WebGLFramebuffer | null = null;
  private maskTexture: WebGLTexture | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCanvasContext: CanvasRenderingContext2D | null = null;

  // Text regions to render masks for
  private textRegions = new Map<string, TextRegionConfig>();

  // Configuration
  private config: TextMaskConfig = {
    lightTextColor: [0.94, 0.96, 1.0, 0.95],     // Light blue-white for dark backgrounds
    darkTextColor: [0.08, 0.12, 0.2, 0.9],       // Dark blue-gray for light backgrounds
    shadowIntensity: 0.3,
    gradientSamples: 16
  };

  // Matrix uniforms
  private projectionMatrix: Mat4;
  private viewMatrix: Mat4;

  // Animation and performance
  private startTime: number;
  private lastUpdateTime = 0;
  private readonly UPDATE_INTERVAL = 16; // ~60fps

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.startTime = performance.now();

    // Initialize matrices for screen-space rendering
    this.projectionMatrix = new Mat4();
    this.viewMatrix = new Mat4();
    this.projectionMatrix.identity();
    this.viewMatrix.identity();

    // Create geometry for rendering full-screen quads
    this.quadGeometry = GeometryBuilder.createFullScreenQuad();
    this.bufferManager = new BufferManager(gl, this.quadGeometry);

    // Initialize mask framebuffer and overlay canvas
    this.initializeMaskFramebuffer();
    this.initializeMaskCanvas();
  }

  /**
   * Initialize shaders for text mask rendering
   */
  async initializeShaders(vertexShader: string, fragmentShader: string): Promise<void> {
    try {
      const uniforms = [
        'u_projectionMatrix',
        'u_viewMatrix',
        'u_time',
        'u_resolution',
        'u_oceanTexture',
        'u_regionPosition',
        'u_regionSize',
        'u_adaptationStrength',
        'u_contrastThreshold',
        'u_transitionSmoothness',
        'u_lightTextColor',
        'u_darkTextColor',
        'u_shadowIntensity',
        'u_gradientSamples'
      ];

      const attributes = [
        'a_position',
        'a_uv'
      ];

      // Create text mask shader program
      this.textMaskProgram = this.shaderManager.createProgram(
        'text-mask',
        vertexShader,
        fragmentShader,
        uniforms,
        attributes
      );

      // Set up vertex attributes
      const positionLocation = this.textMaskProgram.attributeLocations.get('a_position');
      const uvLocation = this.textMaskProgram.attributeLocations.get('a_uv');

      if (positionLocation !== undefined && uvLocation !== undefined) {
        this.bufferManager.setupAttributes(positionLocation, uvLocation);
        console.log('TextMaskRenderer: Shaders initialized successfully');
      } else {
        throw new Error('Failed to get attribute locations');
      }

    } catch (error) {
      console.error('TextMaskRenderer: Failed to initialize shaders:', error);
      throw error;
    }
  }

  /**
   * Register a text region for adaptive masking
   */
  public registerTextRegion(config: TextRegionConfig): void {
    this.textRegions.set(config.elementId, config);
    console.log(`TextMaskRenderer: Registered text region ${config.elementId}`);
  }

  /**
   * Update text region positions based on DOM elements
   */
  public updateTextRegionPositions(): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const canvasRect = canvas.getBoundingClientRect();

    this.textRegions.forEach((region, elementId) => {
      const element = document.getElementById(elementId);
      if (element && !element.classList.contains('hidden')) {
        const rect = element.getBoundingClientRect();

        // Convert to normalized coordinates (0-1)
        const x = (rect.left - canvasRect.left) / canvasRect.width;
        const y = (rect.top - canvasRect.top) / canvasRect.height;
        const width = rect.width / canvasRect.width;
        const height = rect.height / canvasRect.height;

        // Update region position and size
        region.position = [
          Math.max(0, Math.min(1, x)),
          Math.max(0, Math.min(1, y))
        ];
        region.size = [
          Math.max(0, Math.min(1, width)),
          Math.max(0, Math.min(1, height))
        ];
      }
    });
  }

  /**
   * Render text masks for all registered regions
   */
  public renderTextMasks(oceanTexture: WebGLTexture): void {
    if (!this.textMaskProgram || !this.maskFramebuffer) {
      return;
    }

    const now = performance.now();

    // Throttle updates for performance
    if (now - this.lastUpdateTime < this.UPDATE_INTERVAL) {
      return;
    }

    // Update text region positions from DOM
    this.updateTextRegionPositions();

    // Clear the mask framebuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.maskFramebuffer);
    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    // Enable additive blending for overlapping regions
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    // Use text mask shader
    const program = this.shaderManager.useProgram('text-mask');

    // Set common uniforms
    this.shaderManager.setUniformMatrix4fv(program, 'u_projectionMatrix', this.projectionMatrix.data);
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewMatrix', this.viewMatrix.data);
    this.shaderManager.setUniform1f(program, 'u_time', (now - this.startTime) / 1000);
    this.shaderManager.setUniform2f(program, 'u_resolution', this.gl.canvas.width, this.gl.canvas.height);

    // Bind ocean texture
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, oceanTexture);
    this.shaderManager.setUniform1i(program, 'u_oceanTexture', 0);

    // Set mask configuration uniforms
    this.shaderManager.setUniform4f(program, 'u_lightTextColor',
      this.config.lightTextColor[0], this.config.lightTextColor[1],
      this.config.lightTextColor[2], this.config.lightTextColor[3]);
    this.shaderManager.setUniform4f(program, 'u_darkTextColor',
      this.config.darkTextColor[0], this.config.darkTextColor[1],
      this.config.darkTextColor[2], this.config.darkTextColor[3]);
    this.shaderManager.setUniform1f(program, 'u_shadowIntensity', this.config.shadowIntensity);
    this.shaderManager.setUniform1f(program, 'u_gradientSamples', this.config.gradientSamples);

    // Render each text region
    this.textRegions.forEach((region) => {
      // Set region-specific uniforms
      this.shaderManager.setUniform2f(program, 'u_regionPosition', region.position[0], region.position[1]);
      this.shaderManager.setUniform2f(program, 'u_regionSize', region.size[0], region.size[1]);
      this.shaderManager.setUniform1f(program, 'u_adaptationStrength', region.adaptationStrength);
      this.shaderManager.setUniform1f(program, 'u_contrastThreshold', region.contrastThreshold);
      this.shaderManager.setUniform1f(program, 'u_transitionSmoothness', region.transitionSmoothness);

      // Bind geometry and render the region quad
      this.bufferManager.bind();
      this.gl.drawElements(this.gl.TRIANGLES, this.quadGeometry.indexCount, this.gl.UNSIGNED_SHORT, 0);
    });

    this.gl.disable(this.gl.BLEND);

    // Copy framebuffer to overlay canvas
    this.copyMaskToCanvas();

    this.lastUpdateTime = now;
  }

  /**
   * Configure text mask appearance
   */
  public configure(config: Partial<TextMaskConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Register default text regions for common elements
   */
  public registerDefaultTextRegions(): void {
    const defaultRegions: Omit<TextRegionConfig, 'position' | 'size'>[] = [
      {
        elementId: 'landing-panel',
        adaptationStrength: 0.8,
        contrastThreshold: 0.5,
        transitionSmoothness: 0.3
      },
      {
        elementId: 'app-panel',
        adaptationStrength: 0.7,
        contrastThreshold: 0.5,
        transitionSmoothness: 0.3
      },
      {
        elementId: 'portfolio-panel',
        adaptationStrength: 0.7,
        contrastThreshold: 0.5,
        transitionSmoothness: 0.3
      },
      {
        elementId: 'resume-panel',
        adaptationStrength: 0.7,
        contrastThreshold: 0.5,
        transitionSmoothness: 0.3
      },
      {
        elementId: 'navbar',
        adaptationStrength: 0.9,
        contrastThreshold: 0.5,
        transitionSmoothness: 0.2
      }
    ];

    defaultRegions.forEach(region => {
      this.registerTextRegion({
        ...region,
        position: [0, 0],
        size: [0, 0]
      });
    });
  }

  /**
   * Get the mask canvas for CSS overlay composition
   */
  public getMaskCanvas(): HTMLCanvasElement | null {
    return this.maskCanvas;
  }

  /**
   * Initialize framebuffer for mask generation
   */
  private initializeMaskFramebuffer(): void {
    // Create framebuffer
    this.maskFramebuffer = this.gl.createFramebuffer();
    if (!this.maskFramebuffer) {
      throw new Error('Failed to create mask framebuffer');
    }

    // Create texture for mask
    this.maskTexture = this.gl.createTexture();
    if (!this.maskTexture) {
      throw new Error('Failed to create mask texture');
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.maskTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D, 0, this.gl.RGBA,
      this.gl.canvas.width, this.gl.canvas.height, 0,
      this.gl.RGBA, this.gl.UNSIGNED_BYTE, null
    );

    // Set texture parameters
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    // Attach texture to framebuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.maskFramebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D, this.maskTexture, 0
    );

    // Check framebuffer completeness
    if (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !== this.gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Incomplete mask framebuffer');
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  /**
   * Initialize overlay canvas for compositing
   */
  private initializeMaskCanvas(): void {
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.gl.canvas.width;
    this.maskCanvas.height = this.gl.canvas.height;

    // Apply CSS classes for proper styling
    this.maskCanvas.className = 'text-mask-canvas text-mask-optimized blend-multiply';

    // Basic positioning (will be updated in main.ts)
    this.maskCanvas.style.position = 'fixed';
    this.maskCanvas.style.top = '0';
    this.maskCanvas.style.left = '0';
    this.maskCanvas.style.pointerEvents = 'none';
    this.maskCanvas.style.zIndex = '1000';

    this.maskCanvasContext = this.maskCanvas.getContext('2d');
    if (!this.maskCanvasContext) {
      throw new Error('Failed to get 2D context for mask canvas');
    }
  }

  /**
   * Copy mask framebuffer to overlay canvas
   */
  private copyMaskToCanvas(): void {
    if (!this.maskCanvasContext || !this.maskTexture) {
      return;
    }

    // Read pixels from mask framebuffer
    const pixels = new Uint8Array(this.gl.canvas.width * this.gl.canvas.height * 4);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.maskFramebuffer);
    this.gl.readPixels(
      0, 0, this.gl.canvas.width, this.gl.canvas.height,
      this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels
    );

    // Create ImageData and flip Y (WebGL to Canvas coordinate conversion)
    const imageData = this.maskCanvasContext.createImageData(this.gl.canvas.width, this.gl.canvas.height);
    for (let y = 0; y < this.gl.canvas.height; y++) {
      for (let x = 0; x < this.gl.canvas.width; x++) {
        const srcIndex = ((this.gl.canvas.height - 1 - y) * this.gl.canvas.width + x) * 4;
        const dstIndex = (y * this.gl.canvas.width + x) * 4;

        imageData.data[dstIndex] = pixels[srcIndex];
        imageData.data[dstIndex + 1] = pixels[srcIndex + 1];
        imageData.data[dstIndex + 2] = pixels[srcIndex + 2];
        imageData.data[dstIndex + 3] = pixels[srcIndex + 3];
      }
    }

    // Update canvas
    this.maskCanvasContext.putImageData(imageData, 0, 0);
  }

  /**
   * Handle window resize
   */
  public handleResize(): void {
    if (this.maskCanvas) {
      this.maskCanvas.width = this.gl.canvas.width;
      this.maskCanvas.height = this.gl.canvas.height;
    }

    // Recreate framebuffer with new dimensions
    this.disposeMaskFramebuffer();
    this.initializeMaskFramebuffer();
  }

  /**
   * Get performance statistics
   */
  public getStats(): {
    registeredRegions: number;
    lastUpdateTime: number;
    config: TextMaskConfig;
  } {
    return {
      registeredRegions: this.textRegions.size,
      lastUpdateTime: this.lastUpdateTime,
      config: { ...this.config }
    };
  }

  /**
   * Dispose of framebuffer resources
   */
  private disposeMaskFramebuffer(): void {
    if (this.maskFramebuffer) {
      this.gl.deleteFramebuffer(this.maskFramebuffer);
      this.maskFramebuffer = null;
    }
    if (this.maskTexture) {
      this.gl.deleteTexture(this.maskTexture);
      this.maskTexture = null;
    }
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.disposeMaskFramebuffer();

    if (this.maskCanvas && this.maskCanvas.parentNode) {
      this.maskCanvas.parentNode.removeChild(this.maskCanvas);
    }

    this.textRegions.clear();
    console.log('TextMaskRenderer: Disposed');
  }
}