#version 300 es

precision highp float;

// Vertex attributes
in vec2 a_position;  // Vertex position in normalized device coordinates
in vec2 a_uv;        // UV coordinates

// Uniforms
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_regionPosition;    // Text region position in screen space (0-1)
uniform vec2 u_regionSize;        // Text region size in screen space (0-1)

// Output to fragment shader
out vec2 v_uv;               // UV coordinates for the current region
out vec2 v_screenPos;        // Screen position for sampling ocean texture
out vec2 v_regionUV;         // UV within the text region (0-1)
out float v_time;            // Time for animations

void main() {
    // Pass time to fragment shader
    v_time = u_time;

    // Calculate position within the text region
    // Transform from full-screen quad (-1 to 1) to region space
    vec2 regionPos = a_position * 0.5 + 0.5; // Convert to 0-1 range

    // Scale and position for the text region
    vec2 worldPos = u_regionPosition + regionPos * u_regionSize;

    // Convert back to normalized device coordinates (-1 to 1)
    vec2 ndcPos = worldPos * 2.0 - 1.0;

    // Set vertex position
    gl_Position = u_projectionMatrix * u_viewMatrix * vec4(ndcPos, 0.0, 1.0);

    // Pass UV coordinates
    v_uv = a_uv;

    // Screen position for sampling ocean texture (0-1 range)
    v_screenPos = worldPos;

    // Region UV coordinates (0-1 within the text region)
    v_regionUV = regionPos;
}