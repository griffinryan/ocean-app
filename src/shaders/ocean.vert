#version 300 es

in vec3 a_position;
in vec2 a_texcoord;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform float u_time;
uniform float u_aspectRatio;

out vec2 v_uv;
out vec3 v_worldPos;
out float v_time;

void main() {
  // Pass through UV coordinates
  v_uv = a_texcoord;
  v_time = u_time;

  // Calculate world position for the fragment shader
  v_worldPos = a_position;

  // For top-down view, we primarily work in screen space
  // The vertex shader just positions the plane to cover the screen
  vec4 position = vec4(a_position, 1.0);

  // Apply view and projection matrices
  gl_Position = u_projection * u_view * position;
}