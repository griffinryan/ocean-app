/**
 * Test script to validate the enhanced text rendering position system
 * This can be run in the browser console to test position accuracy
 */

(function testPositionValidation() {
  console.log('🧪 Testing Enhanced Text Renderer Position Validation');
  console.log('=====================================================');

  // Check if ocean renderer exists
  if (typeof window.oceanRenderer === 'undefined') {
    console.error('❌ Ocean renderer not found. Make sure the app is running.');
    return;
  }

  const oceanRenderer = window.oceanRenderer;
  const textRenderer = oceanRenderer.textRenderer;

  if (!textRenderer) {
    console.error('❌ Text renderer not found.');
    return;
  }

  console.log('✅ Found text renderer:', textRenderer.constructor.name);

  // Test DOM position extraction
  console.log('\n📍 Testing DOM Position Extraction');
  console.log('-----------------------------------');

  // Test navbar elements
  const navbarElement = document.getElementById('navbar');
  if (navbarElement && !navbarElement.classList.contains('hidden')) {
    const brandElement = navbarElement.querySelector('.brand-text');
    const navItems = navbarElement.querySelectorAll('.nav-label');

    console.log(`✅ Navbar found with ${navItems.length} nav items`);

    if (brandElement) {
      const brandRect = brandElement.getBoundingClientRect();
      console.log(`✅ Brand element: ${brandRect.width.toFixed(1)}×${brandRect.height.toFixed(1)} at (${brandRect.left.toFixed(1)}, ${brandRect.top.toFixed(1)})`);
    }

    navItems.forEach((item, index) => {
      const itemRect = item.getBoundingClientRect();
      console.log(`✅ Nav item ${index}: ${itemRect.width.toFixed(1)}×${itemRect.height.toFixed(1)} at (${itemRect.left.toFixed(1)}, ${itemRect.top.toFixed(1)})`);
    });
  } else {
    console.warn('⚠️ Navbar not found or hidden');
  }

  // Test landing panel elements
  const landingElement = document.getElementById('landing-panel');
  if (landingElement && !landingElement.classList.contains('hidden')) {
    const titleElement = landingElement.querySelector('h1');
    const subtitleElement = landingElement.querySelector('.subtitle');

    console.log('✅ Landing panel found');

    if (titleElement) {
      const titleRect = titleElement.getBoundingClientRect();
      console.log(`✅ Landing title: ${titleRect.width.toFixed(1)}×${titleRect.height.toFixed(1)} at (${titleRect.left.toFixed(1)}, ${titleRect.top.toFixed(1)})`);
    }

    if (subtitleElement) {
      const subtitleRect = subtitleElement.getBoundingClientRect();
      console.log(`✅ Landing subtitle: ${subtitleRect.width.toFixed(1)}×${subtitleRect.height.toFixed(1)} at (${subtitleRect.left.toFixed(1)}, ${subtitleRect.top.toFixed(1)})`);
    }
  } else {
    console.warn('⚠️ Landing panel not found or hidden');
  }

  // Test enhanced text renderer if available
  console.log('\n🎯 Testing Enhanced Text Renderer');
  console.log('----------------------------------');

  console.log('✅ Text renderer type:', textRenderer.constructor.name);

  if (typeof textRenderer.testPositioning === 'function') {
    console.log('✅ Enhanced text renderer detected with position testing');
    try {
      textRenderer.testPositioning();
    } catch (error) {
      console.error('❌ Error testing positioning:', error);
    }
  } else {
    console.log('ℹ️ Standard text renderer or enhanced renderer without position testing');
  }

  // Test validation if available
  if (typeof textRenderer.enableValidation === 'function') {
    console.log('\n🔍 Testing Position Validation');
    console.log('------------------------------');

    try {
      textRenderer.enableValidation(2); // 2px tolerance
      const report = textRenderer.validatePositions();

      if (report) {
        console.log(`✅ Validation completed: ${report.overallAccuracy.toFixed(1)}% accuracy`);
        console.log(`   Elements: ${report.summary.accurateElements}/${report.summary.totalElements} accurate`);
        console.log(`   Average error: ${report.summary.averageError.toFixed(2)}px`);
        console.log(`   Max error: ${report.summary.maxError.toFixed(2)}px`);

        if (report.summary.inaccurateElements > 0) {
          console.warn(`⚠️ ${report.summary.inaccurateElements} elements are inaccurate`);
          report.elementResults.filter(r => !r.isAccurate).forEach(result => {
            console.warn(`   ${result.elementId}: ${result.accuracy.toFixed(1)}% accurate`);
          });
        }
      } else {
        console.warn('⚠️ No validation report generated');
      }
    } catch (error) {
      console.error('❌ Error running validation:', error);
    }
  } else {
    console.log('ℹ️ Position validation not available');
  }

  // Test WebGL position provider if available
  if (typeof textRenderer.getElementWebGLPosition === 'function') {
    console.log('\n🎮 Testing WebGL Position Provider');
    console.log('----------------------------------');

    const testElements = ['navbar-brand', 'nav-brand', 'landing-title', 'landing-subtitle'];

    testElements.forEach(elementId => {
      try {
        const position = textRenderer.getElementWebGLPosition(elementId);
        if (position) {
          console.log(`✅ ${elementId}: ${position.width.toFixed(1)}×${position.height.toFixed(1)} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)})`);
        } else {
          console.log(`ℹ️ ${elementId}: No WebGL position found`);
        }
      } catch (error) {
        console.warn(`⚠️ ${elementId}: Error getting position -`, error.message);
      }
    });
  } else {
    console.log('ℹ️ WebGL position provider not available');
  }

  console.log('\n🏁 Position validation test complete!');
  console.log('====================================');
})();