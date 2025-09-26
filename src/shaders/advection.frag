#version 300 es

precision highp float;

in vec2 v_uv;

uniform sampler2D u_velocityTexture;
uniform sampler2D u_sourceTexture;
uniform float u_deltaTime;
uniform float u_dissipation;
uniform vec2 u_texelSize;

out vec4 fragColor;

void main() {
    vec2 coord = v_uv;

    // Sample velocity at current position
    vec2 velocity = texture(u_velocityTexture, coord).rg;

    // Semi-Lagrangian advection: trace back along velocity field
    vec2 backTracedPos = coord - velocity * u_deltaTime * u_texelSize;

    // Sample the advected quantity
    vec4 advectedValue = texture(u_sourceTexture, backTracedPos);

    // Apply dissipation
    fragColor = advectedValue * u_dissipation;
}