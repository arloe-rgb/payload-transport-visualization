// Draw each replay segment as a screen-space quad to keep its width across camera views.
class TrajectoryLine extends ThreeReplay.Mesh {
  constructor(states, {color, width, dash = 0, gap = 0}) {
    const count = states.length - 1;
    const geometry = new ThreeReplay.InstancedBufferGeometry();
    geometry.setAttribute("position", new ThreeReplay.Float32BufferAttribute([
      0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0,
    ], 3));
    geometry.setIndex([0, 2, 1, 2, 3, 1]);
    const starts = new ThreeReplay.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const ends = new ThreeReplay.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const distances = new ThreeReplay.InstancedBufferAttribute(new Float32Array(count * 2), 2);
    let distance = 0;
    for (let i = 0; i < count; i++) {
      const [x, z] = states[i], [nextX, nextZ] = states[i + 1];
      starts.setXYZ(i, x, 0, z);
      ends.setXYZ(i, nextX, 0, nextZ);
      const length = Math.hypot(nextX - x, nextZ - z);
      distances.setXY(i, distance, distance + length);
      distance += length;
    }
    geometry.setAttribute("segmentStart", starts);
    geometry.setAttribute("segmentEnd", ends);
    geometry.setAttribute("segmentDistance", distances);
    geometry.instanceCount = count;

    super(geometry, new ThreeReplay.ShaderMaterial({
      depthWrite: false,
      alphaToCoverage: true,
      side: ThreeReplay.DoubleSide,
      uniforms: {
        tint: {value: new ThreeReplay.Color(color)},
        resolution: {value: new ThreeReplay.Vector2(1, 1)},
        radius: {value: width / 2},
        dash: {value: dash},
        gap: {value: gap},
      },
      vertexShader: `
        attribute vec3 segmentStart;
        attribute vec3 segmentEnd;
        attribute vec2 segmentDistance;
        uniform vec2 resolution;
        uniform float radius;
        uniform float dash;
        varying vec2 localPosition;
        varying float segmentLength;
        varying float pathDistance;

        void main() {
          vec4 start = projectionMatrix * modelViewMatrix * vec4(segmentStart, 1.0);
          vec4 end = projectionMatrix * modelViewMatrix * vec4(segmentEnd, 1.0);
          vec2 distances = segmentDistance;
          // Clip at the near plane before dividing by w.
          float startDepth = start.z + start.w;
          float endDepth = end.z + end.w;
          if (max(startDepth, endDepth) < 0.0) {
            gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
            return;
          }
          if (startDepth < 0.0) {
            float fraction = startDepth / (startDepth - endDepth);
            start = mix(start, end, fraction);
            distances.x = mix(distances.x, distances.y, fraction);
          } else if (endDepth < 0.0) {
            float fraction = endDepth / (endDepth - startDepth);
            end = mix(end, start, fraction);
            distances.y = mix(distances.y, distances.x, fraction);
          }

          vec2 delta = (end.xy / end.w - start.xy / start.w) * resolution * 0.5;
          segmentLength = length(delta);
          vec2 direction = segmentLength > 0.001 ? delta / segmentLength : vec2(1.0, 0.0);
          vec2 normal = vec2(-direction.y, direction.x);
          float extent = radius + 1.0;
          // A short overlap closes dashed segment joins without filling the gaps.
          float cap = dash > 0.0 ? 0.5 : extent;
          float along = mix(-cap, cap, position.x);
          float across = extent * position.y;
          vec4 clip = mix(start, end, position.x);
          clip.xy += (along * direction + across * normal) * 2.0 / resolution * clip.w;
          gl_Position = clip;
          // Cancel perspective interpolation for distances measured in screen pixels.
          localPosition = vec2(position.x * segmentLength + along, across) * clip.w;
          pathDistance = mix(distances.x, distances.y, position.x);
        }
      `,
      fragmentShader: `
        uniform vec3 tint;
        uniform float radius;
        uniform float dash;
        uniform float gap;
        varying vec2 localPosition;
        varying float segmentLength;
        varying float pathDistance;

        void main() {
          if (dash > 0.0 && mod(pathDistance, dash + gap) >= dash) discard;
          vec2 point = localPosition * gl_FragCoord.w;
          float distance = length(vec2(point.x - clamp(point.x, 0.0, segmentLength), point.y));
          float coverage = 1.0 - smoothstep(radius - 0.5, radius + 0.5, distance);
          if (coverage <= 0.0) discard;
          gl_FragColor = vec4(tint, coverage);
          #include <colorspace_fragment>
        }
      `,
    }));
    this.frustumCulled = false;
  }

  setResolution(width, height) {
    this.material.uniforms.resolution.value.set(width, height);
  }

  setTip(sampleX, sampleZ, x, z) {
    const {segmentStart, segmentEnd} = this.geometry.attributes;
    segmentStart.setXYZ(0, sampleX, 0, sampleZ);
    segmentEnd.setXYZ(0, x, 0, z);
    segmentStart.needsUpdate = segmentEnd.needsUpdate = true;
    this.geometry.instanceCount = sampleX === x && sampleZ === z ? 0 : 1;
  }
}
