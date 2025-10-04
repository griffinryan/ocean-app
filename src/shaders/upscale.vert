#version 300 es

precision highp float;

// Input attributes
in vec2 a_position;
in vec2 a_uv;

// Output to fragment shader
out vec2 v_uv;
out vec2 v_screenPos;

void main() {
    // Pass UV coordinates to fragment shader
    v_uv = a_uv;

    // Pass screen position for effects
    v_screenPos = a_position;

    // Output vertex position
    gl_Position = vec4(a_position, 0.0, 1.0);
}
