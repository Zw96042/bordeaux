// Bordeaux startup mascot. Reuses WRLP's authored SVG groups and running rig.
(function () {
  const mount = document.getElementById('boot-chap-mount');
  if (!mount) return;
  const appRoot = document.getElementById('root');
  if (appRoot) appRoot.inert = true;
  document.documentElement.dataset.chapLoader = 'loading';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const point = {
    body: [496, 290], tail: [572, 232], neck: [340, 280], head: [305, 192],
    hipL: [498, 308], kneeL: [492, 365], ankleL: [432, 390],
    hipR: [538, 326], kneeR: [540, 365], ankleR: [602, 411],
  };

  const element = (name, attributes = {}) => {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  };

  const joint = ([x, y], className, children) => {
    const origin = element('g', { transform: `translate(${x} ${y})` });
    const animated = element('g', { class: className });
    const local = element('g', { transform: `translate(${-x} ${-y})` });
    children.forEach((child) => local.appendChild(child));
    animated.appendChild(local);
    origin.appendChild(animated);
    return origin;
  };

  try {
    const part = (id) => element('use', { href: `assets/wrlp-chap-bird-original.svg#${id}` });
    const svg = element('svg', {
      class: 'boot-chap boot-chap-svg',
      viewBox: '95 40 860 424',
      role: 'img',
      'aria-label': 'Chap, the Westlake Chaparral mascot, running',
    });

    svg.appendChild(element('ellipse', {
      class: 'boot-chap-shadow', cx: 505, cy: 452, rx: 128, ry: 8, fill: '#202126',
    }));
    [[560, 440, 9, ''], [600, 430, 13, ' boot-chap-dust-2'], [575, 446, 6, ' boot-chap-dust-3']]
      .forEach(([cx, cy, r, delay]) => svg.appendChild(element('circle', {
        class: `boot-chap-dust${delay}`, cx, cy, r, fill: '#50535b',
      })));

    const rightFoot = element('g', {
      transform: `translate(${point.ankleR[0] - point.ankleL[0]} ${point.ankleR[1] - point.ankleL[1]}) rotate(-120 ${point.ankleL[0]} ${point.ankleL[1]})`,
    });
    rightFoot.appendChild(part('Left_Leg_Claw'));

    const body = joint(point.body, 'boot-chap-anim boot-chap-bob', [
      joint(point.tail, 'boot-chap-anim boot-chap-tail', [part('Tail')]),
      joint(point.hipR, 'boot-chap-anim boot-chap-leg-r', [
        part('Right_Leg_Upper'),
        joint(point.kneeR, 'boot-chap-anim boot-chap-shin-r', [
          part('Right_Leg_Lower'),
          joint(point.ankleR, 'boot-chap-anim boot-chap-foot-r', [rightFoot]),
        ]),
      ]),
      joint(point.hipL, 'boot-chap-anim boot-chap-leg-l', [
        part('Left_Leg_Upper'),
        joint(point.kneeL, 'boot-chap-anim boot-chap-shin-l', [
          part('Left_Leg_Lower'),
          joint(point.ankleL, 'boot-chap-anim boot-chap-foot-l', [part('Left_Leg_Claw')]),
        ]),
      ]),
      part('Body'),
      part('Neck_Lower'),
      joint(point.neck, 'boot-chap-anim boot-chap-neck', [
        part('Neck_Upper'),
        joint(point.head, 'boot-chap-anim boot-chap-head', [part('Head')]),
      ]),
    ]);
    svg.appendChild(body);
    mount.replaceChildren(svg);
    document.documentElement.dataset.chapLoader = 'rigged';
  } catch (_) {
    // The complete static Chap remains visible if the optional rig cannot initialize.
    document.documentElement.dataset.chapLoader = 'fallback';
  }
})();
