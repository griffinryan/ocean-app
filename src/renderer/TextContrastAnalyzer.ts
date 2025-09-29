/**
 * Text Contrast Analyzer - Analyzes ocean background to determine optimal text colors
 * for maximum legibility and aesthetic coherence
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';

export interface TextElement {
  id: string;
  element: HTMLElement;
  bounds: DOMRect;
  normalizedBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  lastUpdate: number;
}

export interface ContrastMetrics {
  averageLuminance: number;
  colorVariance: number;
  waveIntensity: number;
  dominantColor: [number, number, number];
  recommendedTextColor: [number, number, number];
  recommendedShadow: string;
  contrastRatio: number;
}

export interface AdaptiveTextConfig {
  updateFrequency: number; // Hz
  samplingPoints: number; // Number of sampling points per text element
  contrastThreshold: number; // Minimum contrast ratio (WCAG AAA = 7:1)
  smoothingFactor: number; // Temporal smoothing (0-1)
  glassAwareMode: boolean; // Special handling for glass panel areas
}

export class TextContrastAnalyzer {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private canvas: HTMLCanvasElement;

  // Tracking
  private textElements: Map<string, TextElement> = new Map();
  private lastGlobalUpdate: number = 0;
  private isRunning: boolean = false;

  // Configuration
  private config: AdaptiveTextConfig = {
    updateFrequency: 12, // 12 Hz for smooth updates without performance impact
    samplingPoints: 9, // 3x3 grid sampling
    contrastThreshold: 7.0, // WCAG AAA
    smoothingFactor: 0.7, // Smooth transitions
    glassAwareMode: true
  };

  // WebGL resources for sampling
  private sampleFramebuffer: WebGLFramebuffer | null = null;
  private sampleTexture: WebGLTexture | null = null;
  private sampleProgram: ShaderProgram | null = null;
  private sampleGeometry: GeometryData;
  private sampleBufferManager: BufferManager;

  // Pixel reading buffer
  private pixelBuffer: Uint8Array;

  // Performance tracking
  private frameCount: number = 0;
  private lastFpsTime: number = 0;
  private analysisTime: number = 0;

  constructor(
    gl: WebGL2RenderingContext,
    shaderManager: ShaderManager,
    canvas: HTMLCanvasElement,
    config?: Partial<AdaptiveTextConfig>
  ) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.canvas = canvas;

    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Create geometry for sampling
    this.sampleGeometry = GeometryBuilder.createFullScreenQuad();
    this.sampleBufferManager = new BufferManager(gl, this.sampleGeometry);

    // Initialize pixel buffer (4 bytes per pixel: RGBA)
    this.pixelBuffer = new Uint8Array(this.config.samplingPoints * 4);

    this.initializeSamplingResources();
  }

  /**
   * Initialize WebGL resources for background sampling
   */
  private initializeSamplingResources(): void {
    const gl = this.gl;

    // Create small framebuffer for efficient sampling
    this.sampleFramebuffer = gl.createFramebuffer();
    if (!this.sampleFramebuffer) {
      throw new Error('Failed to create sampling framebuffer');
    }

    // Create texture for sampling results
    this.sampleTexture = gl.createTexture();
    if (!this.sampleTexture) {
      throw new Error('Failed to create sampling texture');
    }

    gl.bindTexture(gl.TEXTURE_2D, this.sampleTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 3, 3, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach texture to framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sampleFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sampleTexture, 0);

    // Check framebuffer completeness
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Sampling framebuffer is not complete');
    }

    // Cleanup
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Initialize the background sampling shader
   */
  async initializeShader(vertexShader: string, fragmentShader: string): Promise<void> {
    const uniforms = [
      'u_oceanTexture',
      'u_normalTexture',
      'u_samplingBounds',
      'u_resolution',
      'u_time'
    ];

    const attributes = [
      'a_position',
      'a_uv'
    ];

    this.sampleProgram = this.shaderManager.createProgram(
      'textSampling',
      vertexShader,
      fragmentShader,
      uniforms,
      attributes
    );

    // Set up vertex attributes
    const positionLocation = this.sampleProgram.attributeLocations.get('a_position')!;
    const uvLocation = this.sampleProgram.attributeLocations.get('a_uv')!;
    this.sampleBufferManager.setupAttributes(positionLocation, uvLocation);
  }

  /**
   * Register a text element for adaptive coloring
   */
  registerTextElement(id: string, element: HTMLElement): void {
    const bounds = element.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();

    this.textElements.set(id, {
      id,
      element,
      bounds,
      normalizedBounds: this.htmlRectToNormalized(bounds, canvasRect),
      lastUpdate: 0
    });

    console.log(`Registered text element: ${id}`);
  }

  /**
   * Unregister a text element
   */
  unregisterTextElement(id: string): void {
    this.textElements.delete(id);
    console.log(`Unregistered text element: ${id}`);
  }

  /**
   * Update text element bounds (call on resize or layout changes)
   */
  updateElementBounds(id: string): void {
    const textElement = this.textElements.get(id);
    if (!textElement) return;

    const bounds = textElement.element.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();

    textElement.bounds = bounds;
    textElement.normalizedBounds = this.htmlRectToNormalized(bounds, canvasRect);
  }

  /**
   * Convert HTML element bounds to normalized coordinates
   */
  private htmlRectToNormalized(elementRect: DOMRect, canvasRect: DOMRect): {
    x: number, y: number, width: number, height: number
  } {
    return {
      x: (elementRect.left - canvasRect.left) / canvasRect.width,
      y: (elementRect.top - canvasRect.top) / canvasRect.height,
      width: elementRect.width / canvasRect.width,
      height: elementRect.height / canvasRect.height
    };
  }

  /**
   * Sample background colors and analyze contrast for a specific text element
   */
  private analyzeElementBackground(
    textElement: TextElement,
    oceanTexture: WebGLTexture,
    normalTexture?: WebGLTexture
  ): ContrastMetrics {
    const gl = this.gl;

    if (!this.sampleProgram || !this.sampleFramebuffer) {
      throw new Error('Sampling resources not initialized');
    }

    // Bind sampling framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sampleFramebuffer);
    gl.viewport(0, 0, 3, 3); // 3x3 sampling grid

    // Use sampling shader
    const program = this.shaderManager.useProgram('textSampling');

    // Set uniforms
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, oceanTexture);
    this.shaderManager.setUniform1i(program, 'u_oceanTexture', 0);

    if (normalTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, normalTexture);
      this.shaderManager.setUniform1i(program, 'u_normalTexture', 1);
    }

    // Set sampling bounds
    const bounds = textElement.normalizedBounds;
    this.shaderManager.setUniform4f(program, 'u_samplingBounds',
      bounds.x, bounds.y, bounds.width, bounds.height);

    this.shaderManager.setUniform2f(program, 'u_resolution', this.canvas.width, this.canvas.height);
    this.shaderManager.setUniform1f(program, 'u_time', performance.now() / 1000.0);

    // Render sampling pattern
    this.sampleBufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.sampleGeometry.indexCount, gl.UNSIGNED_SHORT, 0);

    // Read back pixel data
    gl.readPixels(0, 0, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, this.pixelBuffer);

    // Restore main framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Analyze the sampled data
    return this.calculateContrastMetrics(this.pixelBuffer);
  }

  /**
   * Calculate contrast metrics from sampled pixel data
   */
  private calculateContrastMetrics(pixelData: Uint8Array): ContrastMetrics {
    let totalLuminance = 0;
    let totalR = 0, totalG = 0, totalB = 0;
    let maxLuminance = 0, minLuminance = 1;
    const pixelCount = pixelData.length / 4;

    // Analyze each sampled pixel
    for (let i = 0; i < pixelData.length; i += 4) {
      const r = pixelData[i] / 255.0;
      const g = pixelData[i + 1] / 255.0;
      const b = pixelData[i + 2] / 255.0;

      // Calculate relative luminance (sRGB)
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      totalLuminance += luminance;
      totalR += r;
      totalG += g;
      totalB += b;

      maxLuminance = Math.max(maxLuminance, luminance);
      minLuminance = Math.min(minLuminance, luminance);
    }

    const averageLuminance = totalLuminance / pixelCount;
    const averageColor: [number, number, number] = [
      totalR / pixelCount,
      totalG / pixelCount,
      totalB / pixelCount
    ];

    // Calculate color variance
    const colorVariance = maxLuminance - minLuminance;

    // Determine wave intensity (from normal map analysis)
    const waveIntensity = this.estimateWaveIntensity(pixelData);

    // Calculate optimal text color
    const { textColor, shadowColor, contrastRatio } = this.calculateOptimalTextColor(
      averageLuminance,
      averageColor,
      waveIntensity
    );

    return {
      averageLuminance,
      colorVariance,
      waveIntensity,
      dominantColor: averageColor,
      recommendedTextColor: textColor,
      recommendedShadow: shadowColor,
      contrastRatio
    };
  }

  /**
   * Estimate wave intensity from sampled data
   */
  private estimateWaveIntensity(pixelData: Uint8Array): number {
    // For now, use blue channel variance as wave intensity proxy
    let blueVariance = 0;
    let averageBlue = 0;
    const pixelCount = pixelData.length / 4;

    for (let i = 0; i < pixelData.length; i += 4) {
      averageBlue += pixelData[i + 2] / 255.0;
    }
    averageBlue /= pixelCount;

    for (let i = 0; i < pixelData.length; i += 4) {
      const blue = pixelData[i + 2] / 255.0;
      blueVariance += Math.pow(blue - averageBlue, 2);
    }

    return Math.sqrt(blueVariance / pixelCount);
  }

  /**
   * Calculate optimal text color based on background analysis
   */
  private calculateOptimalTextColor(
    luminance: number,
    _backgroundRGB: [number, number, number],
    waveIntensity: number
  ): { textColor: [number, number, number], shadowColor: string, contrastRatio: number } {

    // Determine if background is light or dark
    const isDark = luminance < 0.5;

    // Base text color choice
    let textColor: [number, number, number];
    let shadowColor: string;

    if (isDark) {
      // Dark background: use white/light text
      textColor = [0.95, 0.95, 0.95];
      shadowColor = `0 1px 3px rgba(0, 0, 0, ${0.7 + waveIntensity * 0.3})`;
    } else {
      // Light background: use dark text
      textColor = [0.1, 0.1, 0.1];
      shadowColor = `0 1px 2px rgba(255, 255, 255, ${0.8 + waveIntensity * 0.2})`;
    }

    // Adjust for wave intensity (foam areas need higher contrast)
    if (waveIntensity > 0.3) {
      if (isDark) {
        // Enhance white text on foamy areas
        textColor = [1.0, 1.0, 1.0];
        shadowColor = `0 0 4px rgba(0, 0, 0, 0.8), 0 1px 3px rgba(0, 0, 0, 0.6)`;
      } else {
        // Enhance dark text on bright foam
        textColor = [0.0, 0.0, 0.0];
        shadowColor = `0 0 3px rgba(255, 255, 255, 0.9), 0 1px 2px rgba(255, 255, 255, 0.7)`;
      }
    }

    // Calculate contrast ratio
    const textLuminance = 0.2126 * textColor[0] + 0.7152 * textColor[1] + 0.0722 * textColor[2];
    const contrastRatio = (Math.max(textLuminance, luminance) + 0.05) /
                         (Math.min(textLuminance, luminance) + 0.05);

    return { textColor, shadowColor, contrastRatio };
  }

  /**
   * Update CSS variables for a text element
   */
  private updateTextCSS(element: HTMLElement, metrics: ContrastMetrics): void {
    const textColor = `rgb(${Math.round(metrics.recommendedTextColor[0] * 255)},
                           ${Math.round(metrics.recommendedTextColor[1] * 255)},
                           ${Math.round(metrics.recommendedTextColor[2] * 255)})`;

    element.style.setProperty('--text-adaptive-color', textColor);
    element.style.setProperty('--text-adaptive-shadow', metrics.recommendedShadow);
    element.style.setProperty('--text-adaptive-contrast', metrics.contrastRatio.toFixed(2));

    // Add adaptive class if not present
    if (!element.classList.contains('adaptive-text')) {
      element.classList.add('adaptive-text');
    }
  }

  /**
   * Update all registered text elements
   */
  update(oceanTexture: WebGLTexture, normalTexture?: WebGLTexture): void {
    if (!this.isRunning) return;

    const now = performance.now();
    const deltaTime = now - this.lastGlobalUpdate;
    const updateInterval = 1000 / this.config.updateFrequency;

    // Throttle updates to target frequency
    if (deltaTime < updateInterval) return;

    const startTime = performance.now();

    // Update visible text elements
    this.textElements.forEach((textElement) => {
      // Check if element is visible and has valid bounds
      if (textElement.element.offsetParent === null ||
          textElement.normalizedBounds.width <= 0 ||
          textElement.normalizedBounds.height <= 0) {
        return;
      }

      try {
        // Analyze background and update CSS
        const metrics = this.analyzeElementBackground(textElement, oceanTexture, normalTexture);
        this.updateTextCSS(textElement.element, metrics);
        textElement.lastUpdate = now;

      } catch (error) {
        console.warn(`Failed to update text element ${textElement.id}:`, error);
      }
    });

    this.analysisTime = performance.now() - startTime;
    this.lastGlobalUpdate = now;
    this.frameCount++;

    // Log performance metrics occasionally
    if (now - this.lastFpsTime > 5000) { // Every 5 seconds
      const avgAnalysisTime = this.analysisTime;
      console.log(`Text Contrast Analysis: ${avgAnalysisTime.toFixed(2)}ms, Elements: ${this.textElements.size}`);
      this.lastFpsTime = now;
    }
  }

  /**
   * Start the adaptive text system
   */
  start(): void {
    this.isRunning = true;
    this.lastGlobalUpdate = performance.now();
    console.log('Text Contrast Analyzer started');
  }

  /**
   * Stop the adaptive text system
   */
  stop(): void {
    this.isRunning = false;
    console.log('Text Contrast Analyzer stopped');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AdaptiveTextConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): {
    elementCount: number;
    lastAnalysisTime: number;
    updateFrequency: number;
    isRunning: boolean;
  } {
    return {
      elementCount: this.textElements.size,
      lastAnalysisTime: this.analysisTime,
      updateFrequency: this.config.updateFrequency,
      isRunning: this.isRunning
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();

    const gl = this.gl;

    if (this.sampleFramebuffer) {
      gl.deleteFramebuffer(this.sampleFramebuffer);
      this.sampleFramebuffer = null;
    }

    if (this.sampleTexture) {
      gl.deleteTexture(this.sampleTexture);
      this.sampleTexture = null;
    }

    this.sampleBufferManager.dispose();
    this.textElements.clear();

    console.log('Text Contrast Analyzer disposed');
  }
}