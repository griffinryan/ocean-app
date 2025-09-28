/**
 * Panel Component System for Liquid Glass UI
 * Manages panel transitions, routing, and glass effects
 */

import { GlassRenderer } from '../renderer/GlassRenderer';

export type PanelState = 'landing' | 'app' | 'portfolio' | 'resume' | 'paper' | 'not-found';

export interface PanelTransition {
  duration: number;
  easing: string;
}

export class PanelManager {
  private currentState: PanelState = 'landing';
  private landingPanel: HTMLElement;
  private appPanel: HTMLElement;
  private portfolioPanel: HTMLElement;
  private resumePanel: HTMLElement;
  private paperBtn: HTMLElement;
  private appBtn: HTMLElement;
  private glassRenderer: GlassRenderer | null = null;

  // Default transition settings
  private defaultTransition: PanelTransition = {
    duration: 600,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
  };

  constructor() {
    this.landingPanel = this.getElement('landing-panel');
    this.appPanel = this.getElement('app-panel');
    this.portfolioPanel = this.getElement('portfolio-panel');
    this.resumePanel = this.getElement('resume-panel');
    this.paperBtn = this.getElement('paper-btn');
    this.appBtn = this.getElement('app-btn');

    this.setupEventListeners();
    this.initializeState();
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Element with ID '${id}' not found`);
    }
    return element;
  }

  private setupEventListeners(): void {
    // Button click handlers
    this.paperBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.transitionTo('paper');
    });

    this.appBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.transitionTo('app');
    });

    // Hash change for browser navigation
    window.addEventListener('hashchange', () => {
      this.handleHashChange();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      this.handleKeyPress(e);
    });
  }

  private handleHashChange(): void {
    const hash = window.location.hash.slice(1); // Remove #

    switch (hash) {
      case 'app':
        this.transitionTo('app');
        break;
      case 'portfolio':
        this.transitionTo('portfolio');
        break;
      case 'resume':
        this.transitionTo('resume');
        break;
      case 'paper':
        this.transitionTo('paper');
        break;
      case '':
        this.transitionTo('landing');
        break;
      default:
        this.transitionTo('not-found');
    }
  }

  private handleKeyPress(event: KeyboardEvent): void {
    // Only handle keys when not typing in input elements
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (event.key) {
      case 'Escape':
        // Return to landing
        if (this.currentState !== 'landing') {
          event.preventDefault();
          window.location.hash = '';
          this.transitionTo('landing');
        }
        break;
      // Removed keyboard shortcuts 1-4 to prevent conflict with debug mode controls
    }
  }

  private initializeState(): void {
    // Check initial hash and set state accordingly
    const hash = window.location.hash.slice(1);
    if (hash) {
      this.handleHashChange();
    } else {
      this.currentState = 'landing';
      this.updatePanelVisibility();
    }
  }

  public transitionTo(newState: PanelState): void {
    if (newState === this.currentState) {
      return;
    }

    console.log(`Transitioning from ${this.currentState} to ${newState}`);

    const oldState = this.currentState;
    this.currentState = newState;

    // Handle special cases
    if (newState === 'paper') {
      this.showNotFoundMessage();
      return;
    }

    if (newState === 'not-found') {
      this.showNotFoundMessage();
      return;
    }

    // Perform the transition
    this.performTransition(oldState, newState);
  }

  private performTransition(oldState: PanelState, newState: PanelState): void {
    // Notify glass renderer that transition is starting
    if (this.glassRenderer) {
      this.glassRenderer.startTransition();
    }

    // Fade out current panel
    this.fadeOutCurrentPanel(oldState);

    // After fade out, show new panel
    setTimeout(() => {
      this.updatePanelVisibility();
      this.fadeInNewPanel(newState);

      // Notify glass renderer that transition is ending
      setTimeout(() => {
        if (this.glassRenderer) {
          this.glassRenderer.endTransition();
        }
      }, this.defaultTransition.duration / 2);
    }, this.defaultTransition.duration / 2);
  }

  private fadeOutCurrentPanel(state: PanelState): void {
    const element = this.getPanelElement(state);
    if (element && !element.classList.contains('hidden')) {
      element.classList.add('fade-out');

      setTimeout(() => {
        element.classList.add('hidden');
        element.classList.remove('fade-out');
      }, this.defaultTransition.duration / 2);
    }
  }

  private fadeInNewPanel(state: PanelState): void {
    const element = this.getPanelElement(state);
    if (element) {
      element.classList.remove('hidden');
      element.classList.add('fade-in');

      setTimeout(() => {
        element.classList.remove('fade-in');

        // Add active class for content panels
        if (state === 'app' || state === 'portfolio' || state === 'resume') {
          element.classList.add('active');
        }
      }, this.defaultTransition.duration / 2);
    }
  }

  private updatePanelVisibility(): void {
    // Reset all panels
    this.landingPanel.classList.add('hidden');
    this.appPanel.classList.add('hidden');
    this.portfolioPanel.classList.add('hidden');
    this.resumePanel.classList.add('hidden');
    this.appPanel.classList.remove('active');
    this.portfolioPanel.classList.remove('active');
    this.resumePanel.classList.remove('active');

    // Show current panel
    const currentPanel = this.getPanelElement(this.currentState);
    if (currentPanel) {
      currentPanel.classList.remove('hidden');
    }
  }

  private getPanelElement(state: PanelState): HTMLElement | null {
    switch (state) {
      case 'landing':
        return this.landingPanel;
      case 'app':
        return this.appPanel;
      case 'portfolio':
        return this.portfolioPanel;
      case 'resume':
        return this.resumePanel;
      default:
        return null;
    }
  }

  private showNotFoundMessage(): void {
    // Create temporary not found panel
    const notFoundPanel = document.createElement('div');
    notFoundPanel.className = 'glass-panel landing-panel';
    notFoundPanel.innerHTML = `
      <h1>Not Found</h1>
      <p class="subtitle">The requested page is not available yet</p>
      <div class="button-group">
        <a href="#" class="glass-button primary">Back to Home</a>
      </div>
    `;

    // Position and show it
    document.body.appendChild(notFoundPanel);

    // Fade out current panels
    this.landingPanel.classList.add('hidden');
    this.appPanel.classList.add('hidden');

    // Add click handler for back button
    const backBtn = notFoundPanel.querySelector('.glass-button') as HTMLElement;
    backBtn?.addEventListener('click', (e) => {
      e.preventDefault();

      // Remove not found panel
      notFoundPanel.classList.add('fade-out');
      setTimeout(() => {
        document.body.removeChild(notFoundPanel);
      }, 300);

      // Return to landing
      window.location.hash = '';
      this.transitionTo('landing');
    });

    // Auto-remove after 3 seconds if paper state
    if (this.currentState === 'paper') {
      setTimeout(() => {
        if (document.body.contains(notFoundPanel)) {
          const btn = notFoundPanel.querySelector('.glass-button') as HTMLElement;
          btn?.click();
        }
      }, 3000);
    }
  }

  // Public API methods
  public setGlassRenderer(glassRenderer: GlassRenderer): void {
    this.glassRenderer = glassRenderer;
  }

  public getCurrentState(): PanelState {
    return this.currentState;
  }

  public addCustomPanel(id: string, content: string): void {
    const panel = document.createElement('div');
    panel.id = id;
    panel.className = 'glass-panel app-panel hidden';
    panel.innerHTML = content;
    document.body.appendChild(panel);
  }

  public enableWebGLDistortion(): void {
    // Mark panels for WebGL enhancement
    this.landingPanel.classList.add('webgl-enhanced');
    this.appPanel.classList.add('webgl-enhanced');
    this.portfolioPanel.classList.add('webgl-enhanced');
    this.resumePanel.classList.add('webgl-enhanced');
  }

  public disableWebGLDistortion(): void {
    // Remove WebGL enhancement
    this.landingPanel.classList.remove('webgl-enhanced');
    this.appPanel.classList.remove('webgl-enhanced');
    this.portfolioPanel.classList.remove('webgl-enhanced');
    this.resumePanel.classList.remove('webgl-enhanced');
  }

  public dispose(): void {
    // Clean up event listeners
    this.paperBtn.removeEventListener('click', () => {});
    this.appBtn.removeEventListener('click', () => {});
    window.removeEventListener('hashchange', () => {});
    document.removeEventListener('keydown', () => {});
  }
}