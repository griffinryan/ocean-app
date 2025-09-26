#version 300 es

in vec3 a_position;
in vec2 a_texcoord;

uniform float u_time;
uniform float u_aspectRatio;
uniform vec2 u_resolution;

out vec2 v_uv;
out vec2 v_screenPos;
out float v_time;

void main() {
  // Pass through UV coordinates
  v_uv = a_texcoord;
  v_time = u_time;

  // Calculate screen position for ocean coordinates
  v_screenPos = a_position.xy;

  // Direct positioning - no matrices needed for full screen quad
  gl_Position = vec4(a_position.xy, 0.0, 1.0);
}