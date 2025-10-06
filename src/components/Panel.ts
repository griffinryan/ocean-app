/**
 * Panel Component System for Liquid Glass UI
 * Manages panel transitions, routing, and glass effects
 */

import type { TextRenderer } from '../renderer/TextRenderer';
import type { GlassRenderer } from '../renderer/GlassRenderer';

export type PanelState = 'landing' | 'app' | 'portfolio' | 'resume' | 'paper' | 'not-found';

export interface PanelTransition {
  duration: number;
  easing: string;
}

export class PanelManager {
  private currentState: PanelState = 'landing';
  private landingPanel: HTMLElement;
  private appBioPanel: HTMLElement;
  private appProfilePicture: HTMLElement;
  private portfolioPanels: HTMLElement[] = [];
  private resumePanels: HTMLElement[] = [];
  private portfolioContainer: HTMLElement;
  private resumeContainer: HTMLElement;
  private paperBtn: HTMLElement;
  private appBtn: HTMLElement;
  private navbar: HTMLElement;

  // Optional TextRenderer reference for triggering updates
  private textRenderer: TextRenderer | null = null;

  // Optional GlassRenderer reference for updating glass panel positions
  private glassRenderer: GlassRenderer | null = null;

  // Default transition settings
  private defaultTransition: PanelTransition = {
    duration: 600,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
  };

  // Transition tracking for proper text update timing
  private activeTransitions: Set<HTMLElement> = new Set();
  private activeAnimations: Set<HTMLElement> = new Set();
  private pendingTimeouts: Set<number> = new Set();
  private transitionTimeout: number | null = null;

  constructor() {
    this.landingPanel = this.getElement('landing-panel');
    this.appBioPanel = this.getElement('app-bio-panel');
    this.appProfilePicture = this.getElement('app-profile-picture');

    // Get scroll containers
    this.portfolioContainer = this.getElement('portfolio-container');
    this.resumeContainer = this.getElement('resume-container');

    // Collect all portfolio panels
    this.portfolioPanels = [
      this.getElement('portfolio-lakehouse-panel'),
      this.getElement('portfolio-encryption-panel'),
      this.getElement('portfolio-dotereditor-panel'),
      this.getElement('portfolio-dreamrequiem-panel'),
      this.getElement('portfolio-greenlightgo-panel')
    ];

    // Collect all resume panels
    this.resumePanels = [
      this.getElement('resume-playember-panel'),
      this.getElement('resume-meta-panel'),
      this.getElement('resume-outlier-panel'),
      this.getElement('resume-uwtutor-panel'),
      this.getElement('resume-uwedu-panel')
    ];

    this.paperBtn = this.getElement('paper-btn');
    this.appBtn = this.getElement('app-btn');
    this.navbar = this.getElement('navbar');

    this.setupEventListeners();
    this.setupTransitionListeners();
    this.setupAnimationListeners();
    this.setupScrollTracking();
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

  /**
   * Setup transitionend listeners on all panels
   * Critical for syncing text updates with CSS transition completion
   */
  private setupTransitionListeners(): void {
    const panels = [
      this.landingPanel,
      this.appBioPanel,
      this.appProfilePicture,
      this.portfolioContainer,
      this.resumeContainer,
      this.navbar
    ];

    panels.forEach(panel => {
      panel.addEventListener('transitionend', (e: TransitionEvent) => {
        // Only handle transitions on the panel itself, not child elements
        if (e.target === panel) {
          this.handleTransitionEnd(panel, e);
        }
      });
    });
  }

  /**
   * Setup animationend listeners on all panels
   * Critical for handling initial page load animations (fadeInUp, etc.)
   */
  private setupAnimationListeners(): void {
    const panels = [
      this.landingPanel,
      this.portfolioContainer,
      this.resumeContainer,
      this.navbar
    ];

    panels.forEach(panel => {
      panel.addEventListener('animationend', (e) => {
        // Only handle animations on the panel itself, not child elements
        if (e.target === panel) {
          this.handleAnimationEnd(panel);
        }
      });
    });
  }

  /**
   * Setup scroll event tracking for text/glass renderer updates
   */
  private setupScrollTracking(): void {
    const containers = [this.portfolioContainer, this.resumeContainer];

    containers.forEach(container => {
      container.addEventListener('scroll', () => {
        if (this.textRenderer) {
          // Force text renderer to update positions on scroll
          this.textRenderer.forceTextureUpdate();
          this.textRenderer.markSceneDirty();
        }
      }, { passive: true });
    });
  }

  /**
   * Handle transition completion on a panel
   * CRITICAL: Only track transform transitions (spatial positioning)
   */
  private handleTransitionEnd(panel: HTMLElement, event: TransitionEvent): void {
    // Only care about transform/translate transitions for spatial positioning
    // Opacity transitions don't affect text position and complete earlier
    const propertyName = event.propertyName;

    if (propertyName !== 'transform' &&
        propertyName !== '-webkit-transform' &&
        !propertyName.startsWith('translate')) {
      console.debug(`PanelManager: Ignoring ${propertyName} transition on ${panel.id}`);
      return;
    }

    // Remove from active transitions set
    this.activeTransitions.delete(panel);

    console.debug(`PanelManager: Transform transition ended on ${panel.id}, ${this.activeTransitions.size} remaining`);

    // Check if all state changes complete
    this.checkAllStateChangesComplete();
  }

  /**
   * Handle animation completion on a panel
   */
  private handleAnimationEnd(panel: HTMLElement): void {
    // Remove from active animations set
    this.activeAnimations.delete(panel);

    console.debug(`PanelManager: Animation ended on ${panel.id}, ${this.activeAnimations.size} remaining`);

    // Check if all state changes complete
    this.checkAllStateChangesComplete();
  }

  /**
   * Check if all transitions, animations, and async state changes are complete
   */
  private checkAllStateChangesComplete(): void {
    if (this.activeTransitions.size === 0 &&
        this.activeAnimations.size === 0 &&
        this.pendingTimeouts.size === 0) {
      this.onAllTransitionsComplete();
    }
  }

  /**
   * Called when all CSS transitions are complete
   */
  private onAllTransitionsComplete(): void {
    console.debug('PanelManager: All transitions complete, waiting for render settle...');

    // Clear any pending timeout
    if (this.transitionTimeout !== null) {
      clearTimeout(this.transitionTimeout);
      this.transitionTimeout = null;
    }

    // CRITICAL: Wait 2 frames for browser to fully render final state
    // Frame 1: Browser computes final styles after transitionend
    // Frame 2: Browser renders final painted state
    // Frame 3: We can safely capture positions
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // CRITICAL FIX: Stop continuous glass position updates
        if (this.glassRenderer) {
          this.glassRenderer.endTransitionMode();
          console.debug('PanelManager: Ended glass transition mode');
        }

        if (this.textRenderer) {
          console.debug('PanelManager: Render settled, enabling text');
          this.textRenderer.setTransitioning(false);
          // Force immediate update
          this.textRenderer.forceTextureUpdate();
          this.textRenderer.markSceneDirty();
        }
      });
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

    // CRITICAL FIX: Start continuous glass position updates during CSS transitions
    // ResizeObserver doesn't fire on transform changes, so we use RAF loop
    if (this.glassRenderer) {
      this.glassRenderer.startTransitionMode();
      console.debug('PanelManager: Started glass transition mode');
    }

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
    // Fade out current panel
    this.fadeOutCurrentPanel(oldState);

    // After fade out, show new panel
    setTimeout(() => {
      this.updatePanelVisibility();
      this.fadeInNewPanel(newState);
    }, this.defaultTransition.duration / 2);
  }

  private fadeOutCurrentPanel(state: PanelState): void {
    const elements = this.getPanelElements(state);
    elements.forEach(element => {
      if (element && !element.classList.contains('hidden')) {
        // Track fade-out transition
        this.activeTransitions.add(element);

        element.classList.add('fade-out');

        // Track setTimeout callback
        const timeoutId = window.setTimeout(() => {
          element.classList.add('hidden');
          element.classList.remove('fade-out');

          // Remove from pending timeouts
          this.pendingTimeouts.delete(timeoutId);
          this.checkAllStateChangesComplete();
        }, this.defaultTransition.duration / 2);

        this.pendingTimeouts.add(timeoutId);
      }
    });
  }

  private fadeInNewPanel(state: PanelState): void {
    const elements = this.getPanelElements(state);
    elements.forEach(element => {
      if (element) {
        // Track fade-in transition
        this.activeTransitions.add(element);

        element.classList.remove('hidden');
        element.classList.add('fade-in');

        // Track setTimeout callback
        const timeoutId = window.setTimeout(() => {
          element.classList.remove('fade-in');

          // Add active class for content panels (this triggers transform transition)
          if (state === 'app' || state === 'portfolio' || state === 'resume') {
            element.classList.add('active');
            // Track the transform transition that follows
            this.activeTransitions.add(element);
          }

          // Remove from pending timeouts
          this.pendingTimeouts.delete(timeoutId);
          this.checkAllStateChangesComplete();
        }, this.defaultTransition.duration / 2);

        this.pendingTimeouts.add(timeoutId);
      }
    });
  }

  private updatePanelVisibility(): void {
    // Reset all panels and containers
    this.landingPanel.classList.add('hidden');
    this.appBioPanel.classList.add('hidden');
    this.appBioPanel.classList.remove('active');
    this.appProfilePicture.classList.add('hidden');
    this.appProfilePicture.classList.remove('active');
    this.portfolioContainer.classList.add('hidden');
    this.resumeContainer.classList.add('hidden');

    // Show current panel(s) or container
    if (this.currentState === 'landing') {
      this.landingPanel.classList.remove('hidden');
    } else if (this.currentState === 'app') {
      this.appBioPanel.classList.remove('hidden');
      this.appProfilePicture.classList.remove('hidden');
    } else if (this.currentState === 'portfolio') {
      this.portfolioContainer.classList.remove('hidden');
      // Reset scroll position
      this.portfolioContainer.scrollTop = 0;
    } else if (this.currentState === 'resume') {
      this.resumeContainer.classList.remove('hidden');
      // Reset scroll position
      this.resumeContainer.scrollTop = 0;
    }

    // Get panels to track for transitions
    const currentPanels = this.getPanelElements(this.currentState);

    // CRITICAL: New transition-aware strategy
    // Block text updates during CSS transitions, only update when complete
    if (this.textRenderer) {
      // Block updates during transition
      this.textRenderer.setTransitioning(true);

      // Track these panels as transitioning
      currentPanels.forEach(panel => {
        if (panel) {
          this.activeTransitions.add(panel);
        }
      });

      // Safety timeout: If transitionend doesn't fire, force update anyway
      if (this.transitionTimeout !== null) {
        clearTimeout(this.transitionTimeout);
      }

      this.transitionTimeout = window.setTimeout(() => {
        console.warn('PanelManager: Transition timeout reached, forcing text update');
        this.activeTransitions.clear();
        this.onAllTransitionsComplete();
      }, this.defaultTransition.duration + 100); // 100ms safety margin
    }
  }

  private getPanelElements(state: PanelState): HTMLElement[] {
    switch (state) {
      case 'landing':
        return [this.landingPanel];
      case 'app':
        return [this.appBioPanel, this.appProfilePicture];
      case 'portfolio':
        return [this.portfolioContainer];
      case 'resume':
        return [this.resumeContainer];
      default:
        return [];
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
    this.appBioPanel.classList.add('webgl-enhanced');
    // Note: Don't add to appProfilePicture - it's not a glass panel
    this.portfolioPanels.forEach(panel => panel.classList.add('webgl-enhanced'));
    this.resumePanels.forEach(panel => panel.classList.add('webgl-enhanced'));
    this.portfolioContainer.classList.add('webgl-enhanced');
    this.resumeContainer.classList.add('webgl-enhanced');
    this.navbar.classList.add('webgl-enhanced');
  }

  public disableWebGLDistortion(): void {
    // Remove WebGL enhancement
    this.landingPanel.classList.remove('webgl-enhanced');
    this.appBioPanel.classList.remove('webgl-enhanced');
    this.portfolioPanels.forEach(panel => panel.classList.remove('webgl-enhanced'));
    this.resumePanels.forEach(panel => panel.classList.remove('webgl-enhanced'));
    this.portfolioContainer.classList.remove('webgl-enhanced');
    this.resumeContainer.classList.remove('webgl-enhanced');
    this.navbar.classList.remove('webgl-enhanced');
  }

  /**
   * Set TextRenderer reference for triggering updates on panel transitions
   */
  public setTextRenderer(textRenderer: TextRenderer | null): void {
    this.textRenderer = textRenderer;
  }

  /**
   * Set GlassRenderer reference for updating glass panel positions during transitions
   */
  public setGlassRenderer(glassRenderer: GlassRenderer | null): void {
    this.glassRenderer = glassRenderer;
  }

  public dispose(): void {
    // Clean up event listeners
    this.paperBtn.removeEventListener('click', () => {});
    this.appBtn.removeEventListener('click', () => {});
    window.removeEventListener('hashchange', () => {});
    document.removeEventListener('keydown', () => {});
  }
}