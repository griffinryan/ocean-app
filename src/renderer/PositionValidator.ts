/**
 * Position Validation System
 * Validates that WebGL text positions exactly match HTML text positions
 */

import { DOMPositionExtractor, ExtractedPosition } from './DOMPositionExtractor';

export interface ValidationResult {
  elementId: string;
  htmlPosition: ExtractedPosition;
  webglPosition: { x: number; y: number; width: number; height: number };
  difference: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  accuracy: number; // 0-100% accuracy score
  isAccurate: boolean; // True if within tolerance
}

export interface ValidationReport {
  timestamp: number;
  overallAccuracy: number;
  elementResults: ValidationResult[];
  summary: {
    totalElements: number;
    accurateElements: number;
    inaccurateElements: number;
    averageError: number;
    maxError: number;
  };
}

export class PositionValidator {
  private domExtractor: DOMPositionExtractor;
  private tolerance: number = 2; // Pixel tolerance for "accurate" positioning

  constructor(canvas: HTMLCanvasElement, tolerance: number = 2) {
    this.domExtractor = new DOMPositionExtractor(canvas);
    this.tolerance = tolerance;
  }

  /**
   * Validate positioning accuracy for all text elements
   */
  validateAllPositions(): ValidationReport {
    const timestamp = performance.now();
    const elementResults: ValidationResult[] = [];

    // Get all panels
    const panels = ['navbar', 'landing-panel', 'app-panel', 'portfolio-panel', 'resume-panel'];

    panels.forEach(panelId => {
      const panelResults = this.validatePanelPositions(panelId);
      elementResults.push(...panelResults);
    });

    // Calculate summary statistics
    const summary = this.calculateSummary(elementResults);

    return {
      timestamp,
      overallAccuracy: summary.totalElements > 0 ? (summary.accurateElements / summary.totalElements) * 100 : 0,
      elementResults,
      summary
    };
  }

  /**
   * Validate positions for a specific panel
   */
  validatePanelPositions(panelId: string): ValidationResult[] {
    const layout = this.domExtractor.extractPanelLayout(panelId);
    if (!layout) return [];

    const results: ValidationResult[] = [];

    layout.elements.forEach((htmlPosition, elementId) => {
      // Get corresponding WebGL position (this would come from the layout system)
      const webglPosition = this.getWebGLPosition(elementId);

      if (webglPosition) {
        const result = this.validateElementPosition(elementId, htmlPosition, webglPosition);
        results.push(result);
      }
    });

    return results;
  }

  /**
   * Validate position for a single element
   */
  validateElementPosition(
    elementId: string,
    htmlPosition: ExtractedPosition,
    webglPosition: { x: number; y: number; width: number; height: number }
  ): ValidationResult {
    // Calculate differences
    const difference = {
      x: Math.abs(htmlPosition.x - webglPosition.x),
      y: Math.abs(htmlPosition.y - webglPosition.y),
      width: Math.abs(htmlPosition.width - webglPosition.width),
      height: Math.abs(htmlPosition.height - webglPosition.height)
    };

    // Calculate accuracy score (0-100%)
    const maxError = Math.max(difference.x, difference.y, difference.width, difference.height);
    const accuracy = Math.max(0, 100 - (maxError / this.tolerance) * 10);

    // Check if within tolerance
    const isAccurate = maxError <= this.tolerance;

    return {
      elementId,
      htmlPosition,
      webglPosition,
      difference,
      accuracy,
      isAccurate
    };
  }

  /**
   * Get WebGL position for an element (mock implementation)
   * In a real implementation, this would query the layout system
   */
  private getWebGLPosition(elementId: string): { x: number; y: number; width: number; height: number } | null {
    // This is a placeholder - in the real implementation, we would:
    // 1. Query the layout system for the element's computed position
    // 2. Convert from layout coordinates to screen coordinates
    // 3. Return the actual WebGL rendering position

    // For now, return a mock position for testing
    return {
      x: 100,
      y: 100,
      width: 200,
      height: 30
    };
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(results: ValidationResult[]): ValidationReport['summary'] {
    if (results.length === 0) {
      return {
        totalElements: 0,
        accurateElements: 0,
        inaccurateElements: 0,
        averageError: 0,
        maxError: 0
      };
    }

    const accurateElements = results.filter(r => r.isAccurate).length;
    const errors = results.map(r => Math.max(r.difference.x, r.difference.y, r.difference.width, r.difference.height));
    const averageError = errors.reduce((sum, error) => sum + error, 0) / errors.length;
    const maxError = Math.max(...errors);

    return {
      totalElements: results.length,
      accurateElements,
      inaccurateElements: results.length - accurateElements,
      averageError,
      maxError
    };
  }

  /**
   * Generate detailed validation report
   */
  generateDetailedReport(report: ValidationReport): string {
    let output = '=== WebGL Text Position Validation Report ===\n\n';

    output += `Timestamp: ${new Date(report.timestamp).toISOString()}\n`;
    output += `Overall Accuracy: ${report.overallAccuracy.toFixed(2)}%\n\n`;

    output += '--- Summary ---\n';
    output += `Total Elements: ${report.summary.totalElements}\n`;
    output += `Accurate Elements: ${report.summary.accurateElements}\n`;
    output += `Inaccurate Elements: ${report.summary.inaccurateElements}\n`;
    output += `Average Error: ${report.summary.averageError.toFixed(2)}px\n`;
    output += `Maximum Error: ${report.summary.maxError.toFixed(2)}px\n\n`;

    output += '--- Element Details ---\n';
    report.elementResults.forEach(result => {
      output += `\nElement: ${result.elementId}\n`;
      output += `  Status: ${result.isAccurate ? '✅ ACCURATE' : '❌ INACCURATE'}\n`;
      output += `  Accuracy: ${result.accuracy.toFixed(1)}%\n`;
      output += `  HTML Position: (${result.htmlPosition.x.toFixed(1)}, ${result.htmlPosition.y.toFixed(1)}) ${result.htmlPosition.width.toFixed(1)}×${result.htmlPosition.height.toFixed(1)}\n`;
      output += `  WebGL Position: (${result.webglPosition.x.toFixed(1)}, ${result.webglPosition.y.toFixed(1)}) ${result.webglPosition.width.toFixed(1)}×${result.webglPosition.height.toFixed(1)}\n`;
      output += `  Error: (${result.difference.x.toFixed(1)}, ${result.difference.y.toFixed(1)}) ${result.difference.width.toFixed(1)}×${result.difference.height.toFixed(1)}\n`;
    });

    return output;
  }

  /**
   * Visual debugging: overlay HTML positions on canvas
   */
  drawPositionOverlays(canvas: HTMLCanvasElement, report: ValidationReport): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Save current state
    ctx.save();

    report.elementResults.forEach(result => {
      const { htmlPosition, webglPosition, isAccurate } = result;

      // Draw HTML position in green
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(htmlPosition.x, htmlPosition.y, htmlPosition.width, htmlPosition.height);

      // Draw WebGL position in red/blue
      ctx.strokeStyle = isAccurate ? 'rgba(0, 0, 255, 0.8)' : 'rgba(255, 0, 0, 0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(webglPosition.x, webglPosition.y, webglPosition.width, webglPosition.height);

      // Draw label
      ctx.fillStyle = 'white';
      ctx.font = '12px monospace';
      ctx.fillText(
        `${result.elementId} (${result.accuracy.toFixed(0)}%)`,
        htmlPosition.x,
        htmlPosition.y - 5
      );
    });

    // Restore state
    ctx.restore();
  }

  /**
   * Continuous validation mode
   */
  startContinuousValidation(interval: number = 1000): () => void {
    const validationInterval = setInterval(() => {
      const report = this.validateAllPositions();
      console.log(`Position Validation: ${report.overallAccuracy.toFixed(1)}% accuracy`);

      if (report.overallAccuracy < 95) {
        console.warn('Low positioning accuracy detected:', report.summary);
      }
    }, interval);

    return () => clearInterval(validationInterval);
  }

  /**
   * Compare two validation reports
   */
  compareReports(oldReport: ValidationReport, newReport: ValidationReport): {
    improvement: number;
    degradation: number;
    changes: Array<{
      elementId: string;
      oldAccuracy: number;
      newAccuracy: number;
      change: number;
    }>;
  } {
    const changes: Array<{
      elementId: string;
      oldAccuracy: number;
      newAccuracy: number;
      change: number;
    }> = [];

    newReport.elementResults.forEach(newResult => {
      const oldResult = oldReport.elementResults.find(r => r.elementId === newResult.elementId);
      if (oldResult) {
        const change = newResult.accuracy - oldResult.accuracy;
        changes.push({
          elementId: newResult.elementId,
          oldAccuracy: oldResult.accuracy,
          newAccuracy: newResult.accuracy,
          change
        });
      }
    });

    const improvements = changes.filter(c => c.change > 0);
    const degradations = changes.filter(c => c.change < 0);

    return {
      improvement: improvements.reduce((sum, c) => sum + c.change, 0),
      degradation: Math.abs(degradations.reduce((sum, c) => sum + c.change, 0)),
      changes
    };
  }
}

// Export utility functions
export function createPositionValidator(canvas: HTMLCanvasElement, tolerance?: number): PositionValidator {
  return new PositionValidator(canvas, tolerance);
}

export function logValidationReport(report: ValidationReport): void {
  console.group('WebGL Text Position Validation');
  console.log(`Overall Accuracy: ${report.overallAccuracy.toFixed(2)}%`);
  console.log(`Elements: ${report.summary.accurateElements}/${report.summary.totalElements} accurate`);
  console.log(`Average Error: ${report.summary.averageError.toFixed(2)}px`);
  console.log(`Max Error: ${report.summary.maxError.toFixed(2)}px`);

  const inaccurateElements = report.elementResults.filter(r => !r.isAccurate);
  if (inaccurateElements.length > 0) {
    console.warn('Inaccurate elements:');
    inaccurateElements.forEach(result => {
      console.warn(`  ${result.elementId}: ${result.accuracy.toFixed(1)}% (error: ${Math.max(result.difference.x, result.difference.y).toFixed(1)}px)`);
    });
  }

  console.groupEnd();
}