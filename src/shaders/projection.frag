#version 300 es

precision highp float;

in vec2 v_uv;

uniform sampler2D u_velocityTexture;
uniform sampler2D u_pressureTexture;
uniform vec2 u_texelSize;

out vec4 fragColor;

void main() {
    vec2 coord = v_uv;

    // Sample current velocity
    vec2 velocity = texture(u_velocityTexture, coord).rg;

    // Sample pressure gradient
    float left   = texture(u_pressureTexture, coord - vec2(u_texelSize.x, 0.0)).r;
    float right  = texture(u_pressureTexture, coord + vec2(u_texelSize.x, 0.0)).r;
    float bottom = texture(u_pressureTexture, coord - vec2(0.0, u_texelSize.y)).r;
    float top    = texture(u_pressureTexture, coord + vec2(0.0, u_texelSize.y)).r;

    // Calculate pressure gradient: ∇p
    vec2 pressureGradient = 0.5 * vec2(
        (right - left) / u_texelSize.x,
        (top - bottom) / u_texelSize.y
    );

    // Project velocity to be divergence-free: v_new = v - ∇p
    vec2 projectedVelocity = velocity - pressureGradient;

    fragColor = vec4(projectedVelocity, 0.0, 1.0);
}