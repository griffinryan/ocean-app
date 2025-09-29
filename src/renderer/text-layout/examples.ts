/**
 * Usage Examples for WebGL Text Layout System
 * Demonstrates how to use the CSS-like text layout abstraction
 */

import { TextRenderer } from '../TextRenderer';
import { createWebGLTextLayout, QuickStart, Components, Styles } from './index';

// ===== BASIC USAGE =====

/**
 * Example 1: Quick Setup
 */
export function basicExample(textRenderer: TextRenderer) {
  // Enable CSS-like layout system
  const layout = QuickStart.enableCSS(textRenderer);

  // Create simple centered text
  layout.create({
    tag: 'div',
    style: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      width: '100vw',
      height: '100vh'
    },
    children: [
      {
        tag: 'h1',
        text: 'Hello WebGL Text Layout!',
        style: {
          fontSize: '48px',
          fontWeight: '600',
          color: 'white',
          textAlign: 'center'
        }
      }
    ]
  });

  // Render the layout
  layout.render();
}

// ===== FLEXBOX LAYOUTS =====

/**
 * Example 2: Modern Flexbox Layout
 */
export function flexboxExample(textRenderer: TextRenderer) {
  const layout = createWebGLTextLayout(textRenderer);

  // Create navigation bar
  layout.create({
    tag: 'nav',
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '20px',
      width: '100vw',
      height: '80px',
      position: 'fixed',
      top: 0
    },
    children: [
      {
        tag: 'div',
        text: 'Brand',
        style: { fontSize: '24px', fontWeight: '700' }
      },
      {
        tag: 'div',
        style: { display: 'flex', gap: '24px' },
        children: [
          { tag: 'span', text: 'Home', style: { fontSize: '16px' } },
          { tag: 'span', text: 'About', style: { fontSize: '16px' } },
          { tag: 'span', text: 'Contact', style: { fontSize: '16px' } }
        ]
      }
    ]
  });

  // Create main content with cards
  layout.create({
    tag: 'main',
    style: {
      display: 'flex',
      flexDirection: 'column',
      padding: '100px 20px 20px',
      gap: '24px',
      maxWidth: '800px',
      margin: '0 auto'
    },
    children: [
      {
        tag: 'h1',
        text: 'Welcome to Our App',
        style: {
          fontSize: '36px',
          fontWeight: '600',
          textAlign: 'center',
          marginBottom: '32px'
        }
      },
      ...generateCards(3)
    ]
  });

  layout.render();
}

// ===== RESPONSIVE DESIGN =====

/**
 * Example 3: Responsive Layout with Media Queries
 */
export function responsiveExample(textRenderer: TextRenderer) {
  const layout = createWebGLTextLayout(textRenderer, {
    enableResponsive: true
  });

  // Set up responsive breakpoints
  layout.addBreakpoint('mobile', { maxWidth: 767 });
  layout.addBreakpoint('tablet', { minWidth: 768, maxWidth: 1023 });
  layout.addBreakpoint('desktop', { minWidth: 1024 });

  // Add media queries
  layout.addMediaQuery('mobile-styles', 'max-width: 767px', {
    '.container': { padding: '16px', fontSize: '14px' },
    '.title': { fontSize: '24px' }
  });

  layout.addMediaQuery('desktop-styles', 'min-width: 1024px', {
    '.container': { padding: '32px', fontSize: '18px' },
    '.title': { fontSize: '48px' }
  });

  // Set global stylesheet
  layout.setStyles({
    '.container': {
      display: 'flex',
      flexDirection: 'column',
      padding: '24px',
      maxWidth: '1200px',
      margin: '0 auto'
    },
    '.title': {
      fontSize: '36px',
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: '24px'
    },
    '.grid': {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '16px'
    },
    '.card': {
      flex: '1 1 300px',
      padding: '20px',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      borderRadius: '8px'
    }
  });

  // Create responsive layout
  layout.create({
    tag: 'div',
    className: 'container',
    children: [
      {
        tag: 'h1',
        text: 'Responsive WebGL Text',
        className: 'title'
      },
      {
        tag: 'div',
        className: 'grid',
        children: [
          {
            tag: 'div',
            className: 'card',
            children: [
              { tag: 'h3', text: 'Card 1', style: { marginBottom: '12px' } },
              { tag: 'p', text: 'This layout adapts to different screen sizes using CSS media queries.' }
            ]
          },
          {
            tag: 'div',
            className: 'card',
            children: [
              { tag: 'h3', text: 'Card 2', style: { marginBottom: '12px' } },
              { tag: 'p', text: 'Text size and spacing adjust automatically based on viewport width.' }
            ]
          },
          {
            tag: 'div',
            className: 'card',
            children: [
              { tag: 'h3', text: 'Card 3', style: { marginBottom: '12px' } },
              { tag: 'p', text: 'Perfect for creating responsive WebGL user interfaces.' }
            ]
          }
        ]
      }
    ]
  });

  layout.render();
}

// ===== ADVANCED STYLING =====

/**
 * Example 4: Advanced Styling with Custom Components
 */
export function advancedStylingExample(textRenderer: TextRenderer) {
  const layout = createWebGLTextLayout(textRenderer);

  // Register custom components
  layout.builder.registerComponent('GlassCard', {
    tag: 'div',
    style: {
      padding: '24px',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
    }
  });

  layout.builder.registerComponent('GradientText', {
    tag: 'span',
    style: {
      background: 'linear-gradient(45deg, #ff6b6b, #4ecdc4)',
      backgroundClip: 'text',
      color: 'transparent',
      fontWeight: '700'
    }
  });

  // Create layout with custom components
  layout.create({
    tag: 'div',
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px',
      minHeight: '100vh',
      gap: '32px'
    },
    children: [
      {
        ...layout.builder.useComponent('GradientText'),
        text: 'Advanced WebGL Styling',
        style: { fontSize: '48px', marginBottom: '16px' }
      },
      {
        ...layout.builder.useComponent('GlassCard'),
        style: { maxWidth: '600px' },
        children: [
          {
            tag: 'h2',
            text: 'Glass Morphism Effect',
            style: { fontSize: '24px', marginBottom: '16px' }
          },
          {
            tag: 'p',
            text: 'This card demonstrates advanced styling capabilities including backdrop blur, gradients, and glass morphism effects rendered in WebGL.',
            style: { lineHeight: 1.6, opacity: 0.9 }
          }
        ]
      }
    ]
  });

  layout.render();
}

// ===== INTEGRATION WITH EXISTING SYSTEM =====

/**
 * Example 5: Integration with Existing Ocean App
 */
export function oceanAppIntegration(textRenderer: TextRenderer) {
  const layout = createWebGLTextLayout(textRenderer, {
    enableResponsive: true,
    debug: true
  });

  // Set up ocean-specific styles
  layout.setStyles({
    '.ocean-panel': {
      position: 'absolute',
      padding: '32px',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      backdropFilter: 'blur(20px)',
      borderRadius: '20px',
      border: '2px solid rgba(255, 255, 255, 0.25)',
      webglPanel: 'landing-panel', // Custom WebGL property
      webglAdaptiveColor: true
    },
    '.ocean-title': {
      fontSize: 'clamp(32px, 5vw, 64px)',
      fontWeight: '200',
      textAlign: 'center',
      marginBottom: '24px',
      webglAdaptiveColor: true
    },
    '.ocean-subtitle': {
      fontSize: 'clamp(16px, 2.5vw, 24px)',
      fontWeight: '400',
      textAlign: 'center',
      opacity: 0.8,
      lineHeight: 1.5
    }
  });

  // Create ocean-themed layout
  layout.create({
    tag: 'div',
    className: 'ocean-panel',
    style: {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'min(90vw, 500px)'
    },
    children: [
      {
        tag: 'h1',
        text: 'Ocean Simulation Portfolio',
        className: 'ocean-title'
      },
      {
        tag: 'p',
        text: 'Real-time WebGL ocean rendering with dynamic waves and interactive glass effects',
        className: 'ocean-subtitle'
      },
      {
        tag: 'div',
        style: {
          display: 'flex',
          gap: '16px',
          justifyContent: 'center',
          marginTop: '32px'
        },
        children: [
          {
            tag: 'div',
            text: 'View Project',
            style: {
              padding: '12px 24px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '500',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }
          },
          {
            tag: 'div',
            text: 'Read Documentation',
            style: {
              padding: '12px 24px',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '500',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }
          }
        ]
      }
    ]
  });

  layout.render();
}

// ===== HELPER FUNCTIONS =====

function generateCards(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    tag: 'div',
    style: {
      padding: '24px',
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
      borderRadius: '12px',
      border: '1px solid rgba(255, 255, 255, 0.15)'
    },
    children: [
      {
        tag: 'h3',
        text: `Feature ${i + 1}`,
        style: {
          fontSize: '20px',
          fontWeight: '600',
          marginBottom: '12px'
        }
      },
      {
        tag: 'p',
        text: `This is a description of feature ${i + 1}. It demonstrates the power of CSS-like layouts in WebGL.`,
        style: {
          fontSize: '16px',
          lineHeight: 1.5,
          opacity: 0.9
        }
      }
    ]
  }));
}

// ===== EXPORT ALL EXAMPLES =====

export const Examples = {
  basic: basicExample,
  flexbox: flexboxExample,
  responsive: responsiveExample,
  advancedStyling: advancedStylingExample,
  oceanApp: oceanAppIntegration
};

export default Examples;