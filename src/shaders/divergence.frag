#version 300 es

precision highp float;

in vec2 v_uv;

uniform sampler2D u_velocityTexture;
uniform vec2 u_texelSize;

out vec4 fragColor;

void main() {
    vec2 coord = v_uv;

    // Sample velocity at neighbors
    float left   = texture(u_velocityTexture, coord - vec2(u_texelSize.x, 0.0)).r;
    float right  = texture(u_velocityTexture, coord + vec2(u_texelSize.x, 0.0)).r;
    float bottom = texture(u_velocityTexture, coord - vec2(0.0, u_texelSize.y)).g;
    float top    = texture(u_velocityTexture, coord + vec2(0.0, u_texelSize.y)).g;

    // Calculate divergence: ∇·v = ∂u/∂x + ∂v/∂y
    float divergence = 0.5 * ((right - left) / u_texelSize.x + (top - bottom) / u_texelSize.y);

    fragColor = vec4(divergence, 0.0, 0.0, 1.0);
}