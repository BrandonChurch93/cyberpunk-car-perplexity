"""The body's feature network, left half (X >= 0), traced from the design grant views.

Reads are pixel positions in the cropped grant views: s = side (fig. 4, nose left), t = top (fig. 3),
f = front (fig. 6, car's left is the image's right half), r = rear (fig. 7, car's left is the image's left half).
"""
import numpy as np
from net import Network, side, rear, recess


def S(px, py, x):
    d = side(px, py)
    return (x, d['y'], d['z'])


def R(px, py, z):
    d = rear(px, py)
    return (d['x'], d['y'], z)


FH, RH = (1.286, 0.3405, 0.373), (-1.493, 0.3625, 0.415)


def arc(h, a, x, dr=0.0):
    t = np.radians(a)
    return (x, h[1] + (h[2] + dr) * np.sin(t), h[0] - (h[2] + dr) * np.cos(t))


ZP = ((0.0, -2.474), (0.43, -2.466), (0.511, -2.391), (0.589, -2.346), (0.662, -2.301), (0.727, -2.256), (0.79, -2.21),
      (0.849, -2.165), (0.887, -2.12), (0.923, -2.03), (0.957, -1.94), (0.995, -1.85))
KX = 0.43


def zp(x):
    """Plan outline of the tail (rearmost z at half width x), read from the top view."""
    return float(np.interp(x, *zip(*ZP)))


SPL = ((0.15, 2.454), (0.30, 2.4075), (0.45, 2.375), (0.60, 2.290), (0.75, 2.178), (0.85, 2.075), (0.90, 1.951),
       (0.937, 1.84), (0.981, 1.70))


def inset(pts, y, d, ends):
    """Plan polyline pts moved inward by d at height y, between fixed end points."""
    P = np.array([ends[0]] + list(pts) + [ends[1]], float)
    t = np.gradient(P, axis=0)
    n = np.stack([t[:, 1], -t[:, 0]], 1) / np.linalg.norm(t, axis=1)[:, None]
    n *= np.sign((n * P).sum(1))[:, None]
    Q = P[1:-1] - d * n[1:-1]
    return [(float(q[0]), y, float(q[1])) for q in Q]


def zb(x):
    """Lamp band surface: 50 mm ahead of the blade across the centre, 45 mm on the swept sides."""
    return float(np.interp(x, (0.0, 0.22, KX, 0.65, 0.872), (-2.415, -2.413, -2.405, -2.262, -2.098)))


def network():
    n = Network()
    P, E, F = n.P, n.E, n.F

    def Q(name, p):
        n.points[name] = np.asarray(p, float)
        n.reads[name] = {}

    # nose, hood, wing top
    P('N0', s=(5, 425), f=(712, 472), x=0.0)
    P('N1', f=(933, 470), t=(48, 827))
    P('Ap', f=(1005, 397), t=(165, 890))
    P('Ci', f=(893, 234), t=(455, 808))
    P('C0', f=(712, 240), t=(440, 630.5), x=0.0)
    P('Pb', f=(1245, 230), t=(700, 1075))
    P('Pc', f=(1283, 238), t=(690, 1122))
    P('Lo', f=(1270, 322), s=(390, 295))
    E('hood_le', ['N0', (0.18, 0.421, 2.44), 'N1'])
    E('hood_ctr', ['N0', (0.0, 0.62, 2.10), 'C0'])
    E('hood_cr', ['N1', 'Ap'])
    E('crease_out', ['Ap', 'Pb'])
    E('crease_in', ['Ap', 'Ci'])
    E('cowl_in', ['C0', (0.15, 0.789, 1.672), 'Ci'])
    E('cowl_out', ['Ci', (0.58, 0.80, 1.45), 'Pb'])
    E('lamp_top', ['N1', (0.64, 0.545, 2.08), 'Lo'])
    E('crest', ['Lo', (0.895, 0.72, 1.52), 'Pc'])
    E('screen_corner', ['Pb', 'Pc'])
    F('hood', ['hood_ctr', 'cowl_in', 'crease_in', 'hood_cr', 'hood_le'], crown=0.008, hint=(0, 1, 0.3))
    F('notch', ['crease_in', 'cowl_out', 'crease_out'], crown=-0.004, hint=(0.3, 1, 0.3))
    F('wing_top', ['hood_cr', 'crease_out', 'screen_corner', 'crest', 'lamp_top'], crown=0.005, hint=(0.3, 1, 0.3))

    # headlamp opening, outer Y arms, front intake
    P('Yn', f=(1226, 446), s=(250, 395))
    P('Bl', f=(1290, 560), s=(335, 500))
    P('Bc', f=(1245, 640), s=(245, 550))
    n.points['Bc1'] = n.points['Bc'] + (-0.004, 0.045, 0.0)
    n.reads['Bc1'] = {}
    Q('I0', (0.0, 0.366, 2.445))
    Q('I1', (0.0, 0.193, 2.462))
    Q('I2', (0.0, 0.155, 2.4705))
    Q('Db', (0.459, 0.19, 2.342))
    Q('Dt', (0.337, 0.272, 2.385))
    E('lamp_outer', ['Lo', (0.86, 0.56, 1.90), 'Yn'])
    E('lamp_low', ['N1', (0.60, 0.452, 2.27), 'Yn'])
    E('arm_low', ['Yn', 'Bl'])
    E('arm_down', ['Bl', 'Bc1'])
    E('int_top', ['I0', (0.18, 0.385, 2.425), 'N1'])
    E('nose_ctr', ['N0', 'I0'])
    E('int_ctr', ['I0', 'I1'])
    E('lip_top', ['I1', (0.23, 0.1915, 2.416), 'Db'])
    E('bl_base', ['Db', (0.62, 0.183, 2.258), 'Bc'])
    E('bl_in', ['Db', 'Dt'])
    F('nose_face', ['hood_le', 'int_top', 'nose_ctr'], mat='black', hint=(0, 0.3, 1))
    recess(n, 'lamp', ['lamp_top', 'lamp_outer', 'lamp_low'], (-0.01, -0.01, -0.13), hint=(0.2, 0.3, 1))
    F('lamp_lens', ['lamp_top', 'lamp_outer', 'lamp_low'], obj='glass', mat='optics', crown=0.004, hint=(0.2, 0.3, 1))

    # front corner, lip, splitter
    Q('Aft', arc(FH, 140, 0.986))
    Q('Af', arc(FH, -156, 0.99))
    Q('Afb', (0.993, 0.155, 1.633))
    Q('Sp0', (0.0, 0.13, 2.4725))
    Q('Sp1', (0.996, 0.13, 1.630))
    E('corner_up', ['Lo', 'Aft'])
    E('bl_top', ['Dt', (0.60, 0.232, 2.276), 'Bc1'])
    E('bl_end', ['Bc', 'Bc1'])
    recess(n, 'intake', ['int_top', 'lamp_low', 'arm_low', 'arm_down', 'bl_top', 'bl_in', 'lip_top', 'int_ctr'], (0.0, 0.0, -0.16), hint=(0, 0, 1))
    E('arch_f1', ['Aft', arc(FH, 160, 0.987), arc(FH, 180, 0.988), arc(FH, -165, 0.989), 'Af'])
    E('lip_side', ['Bc', (0.919, 0.172, 1.85), 'Af'])
    E('lip_end', ['Af', 'Afb'])
    E('lip_bot', ['I2'] + inset(SPL, 0.155, 0.006, ((0.0, 2.4725), (0.996, 1.630))) + ['Afb'])
    E('lip_ctr', ['I1', 'I2'])
    E('spl_ctr', ['I2', 'Sp0'])
    E('spl_end', ['Afb', 'Sp1'])
    E('spl_edge', ['Sp0'] + [(x, 0.13, z) for x, z in SPL] + ['Sp1'])
    F('corner', ['lamp_outer', 'arm_low', 'arm_down', 'bl_end', 'lip_side', 'arch_f1', 'corner_up'], crown=0.004, hint=(0.6, 0.1, 0.8))
    Q('Lm0', (0.0, 0.174, 2.467))
    Q('Lm1', (0.72, 0.171, 2.20))
    E('lip_mid', ['Lm0', (0.35, 0.173, 2.383), (0.61, 0.171, 2.274), 'Lm1'], kind='guide')
    F('blade', ['bl_in', 'bl_top', 'bl_end', 'bl_base'], crown=0.002, hint=(0.3, 0.1, 1))
    F('lip', ['lip_top', 'bl_base', 'lip_side', 'lip_end', 'lip_bot', 'lip_ctr'], hint=(0.3, 0, 1), guides=['lip_mid'])
    F('splitter', ['lip_bot', 'spl_end', 'spl_edge', 'spl_ctr'], mat='black', hint=(0, -0.3, 1))

    # front fender, A pillar, windshield, roof
    Q('At', arc(FH, 90, 1.0))
    Q('Arr', arc(FH, 40, 1.0))
    Q('Ar', arc(FH, -26, 0.995))
    Q('Arb', (0.985, 0.13, 0.94))
    E('arch_f2', ['Aft', arc(FH, 115, 0.995), 'At', arc(FH, 65, 1.0), 'Arr'])
    E('arch_f3', ['Arr', arc(FH, 15, 1.0), arc(FH, -8, 0.998), 'Ar'])
    E('door_f', ['Gf', S(880, 260, 0.985), 'Arr'])
    E('wing_back', ['Pc', S(810, 205, 0.935), 'Gf'])
    F('fender', ['crest', 'wing_back', 'door_f', 'arch_f2', 'corner_up'], crown=0.0, hint=(1, 0.3, 0.2))

    Q('W0', (0.0, 1.110, 0.456))
    Q('Pt', (0.60, 1.080, 0.440))
    Q('Rr', (0.47, 1.105, -0.760))
    Q('R0', (0.0, 1.125, -0.760))
    E('ws_ctr', ['C0', (0.0, 0.96, 1.08), 'W0'])
    E('a_in', ['Pb', (0.75, 0.96, 0.85), 'Pt'])
    E('ws_top', ['W0', (0.32, 1.105, 0.452), 'Pt'])
    F('windshield', ['ws_ctr', 'ws_top', 'a_in', 'cowl_out', 'cowl_in'], obj='glass', mat='glass', crown=0.01, hint=(0, 1, 0.5))
    E('rail', ['Pt', (0.665, 1.112, 0.0), (0.60, 1.115, -0.45), 'Rr'])
    E('roof_ctr', ['W0', (0.0, 1.160, 0.0), (0.0, 1.150, -0.40), 'R0'])
    E('roof_rear', ['R0', (0.24, 1.122, -0.765), 'Rr'])
    F('roof', ['roof_ctr', 'roof_rear', 'rail', 'ws_top'], crown=0.006, hint=(0, 1, 0))

    # side glass in its frame
    P('Gf', s=(985, 222), x=0.95)
    P('Gt', s=(1005, 110), x=0.775)
    P('Wr1', s=(1592, 62), x=0.700)
    P('Dr0', s=(1580, 150), x=0.900)
    E('belt', ['Gf', S(1290, 195, 0.925), 'Dr0'])
    E('g_front', ['Gf', S(1002, 170, 0.87), 'Gt'])
    E('g_top', ['Gt', S(1300, 45, 0.735), 'Wr1'])
    E('g_rear', ['Dr0', S(1587, 105, 0.80), 'Wr1'])
    E('a_out', ['Gt', S(1120, 60, 0.70), 'Pt'])
    E('frame_r', ['Wr1', (0.62, 1.09, -0.55), 'Rr'])
    F('side_glass', ['belt', 'g_rear', 'g_top', 'g_front'], obj='glass', mat='glass', crown=0.01, hint=(1, 0.3, 0))
    F('a_pillar', ['screen_corner', 'a_in', 'a_out', 'g_front', 'wing_back'], hint=(1, 0.6, 0.3), mat='black')
    F('frame_top', ['a_out', 'rail', 'frame_r', 'g_top'], hint=(1, 1, 0), mat='black')

    # door, diagonal crease, side intake, dart
    P('Ii0', s=(1475, 265), x=1.0)
    P('Ii1', s=(1625, 255), x=0.985)
    P('Ii2', s=(1790, 410), x=0.975)
    P('Ii3', s=(1700, 460), x=0.985)
    P('Xd', s=(1577, 361), x=0.995)
    P('Xd2', s=(1548, 463), x=0.99)
    P('Dd0', s=(1040, 505), x=0.985)
    P('Ds2', s=(1050, 525), x=0.99)
    P('Dr2', s=(1540, 523), x=0.99)
    Q('Rs', arc(RH, -160, 0.995))
    Q('Rsb', (0.985, 0.13, -1.07))
    E('diag', ['Arr', S(1150, 298, 1.012), 'Ii0'])
    E('int_top_e', ['Ii0', S(1550, 258, 0.995), 'Ii1'])
    E('shut_up', ['Ii1', S(1605, 205, 0.95), 'Dr0'])
    E('blade_a', ['Ii0', 'Xd'])
    E('shut_mid', ['Xd', 'Xd2'])
    E('dart_a', ['Dd0', S(1300, 485, 0.995), 'Xd2'])
    E('dlf', ['Arr', S(900, 345, 1.0), 'Dd0'])
    E('shut_low', ['Xd2', 'Dr2'])
    E('door_bot', ['Ds2', S(1300, 526, 0.99), 'Dr2'])
    E('dd', ['Dd0', 'Ds2'])
    F('door_up', ['door_f', 'diag', 'int_top_e', 'shut_up', 'belt'], crown=0.006, hint=(1, 0.2, 0))
    F('door_mid', ['diag', 'blade_a', 'shut_mid', 'dart_a', 'dlf'], crown=-0.004, hint=(1, 0, 0))
    F('door_low', ['dart_a', 'shut_low', 'door_bot', 'dd'], crown=0.002, hint=(1, -0.3, 0))
    E('vent_bot', ['Ar', S(950, 540, 0.99), 'Ds2'])
    recess(n, 'vent', ['arch_f3', 'dlf', 'dd', 'vent_bot'], (-0.10, 0.0, 0.0), hint=(1, 0, 0))
    E('sill_top', ['Dr2', S(1750, 522, 0.995), 'Rs'])
    E('sill_bot', ['Arb', (0.985, 0.13, 0.0), 'Rsb'])
    E('sill_f', ['Ar', 'Arb'])
    E('sill_r', ['Rs', 'Rsb'])
    F('sill', ['vent_bot', 'door_bot', 'sill_top', 'sill_r', 'sill_bot', 'sill_f'], hint=(1, -0.2, 0), mat='black')

    E('int_rear', ['Ii1', S(1705, 330, 0.98), 'Ii2'])
    E('int_bot', ['Ii2', 'Ii3'])
    E('blade_b', ['Xd', 'Ii3'])
    E('dart_b', ['Ii3', 'Xd2'])
    F('q_tri', ['shut_mid', 'blade_b', 'dart_b'], hint=(1, 0, 0))
    E('q_split', ['Ii2', S(1880, 470, 0.99), 'Rs'])
    F('q_front', ['int_bot', 'dart_b', 'shut_low', 'sill_top', 'q_split'], hint=(1, 0, 0))
    recess(n, 'sideint', ['int_top_e', 'int_rear', 'int_bot', 'blade_b', 'blade_a'], (-0.15, 0.0, 0.03), hint=(1, 0, 0))

    # rear quarter, haunch, deck, bay edge
    Q('Rt', arc(RH, 90, 1.016))
    Q('Rb', arc(RH, 5, 0.985))
    Q('Tc', (0.93, 0.905, -1.975))
    Q('Sh1', (1.012, 0.80, -1.10))
    E('arch_r', ['Rs', arc(RH, -178, 1.006), arc(RH, 150, 1.013), arc(RH, 120, 1.015), 'Rt', arc(RH, 60, 1.015), arc(RH, 30, 1.01), 'Rb'])
    Q('Rm', (0.958, 0.621, -1.985))
    E('rear_side', ['Rb', (0.971, 0.51, -1.949), 'Rm'])
    E('rear_side_up', ['Rm', (0.944, 0.761, -1.990), 'Tc'])
    E('shoulder', ['Ii1', S(1800, 214, 1.0), 'Sh1', S(2200, 158, 1.0), 'Tc'])
    F('q_up', ['int_rear', 'q_split', 'arch_r', 'rear_side', 'rear_side_up', 'shoulder'], crown=0.006, hint=(1, 0.2, 0))

    Q('Bk', (0.30, 0.955, -1.95))
    Q('Bk0', (0.0, 0.955, -1.98))
    Q('Ht', (0.62, 0.935, -2.0))
    Q('Hc', (0.86, 0.985, -1.10))
    E('bay_edge', ['Rr', (0.42, 1.04, -1.30), 'Bk'])
    E('deck_rear', ['Bk', 'Ht'])
    E('tail_top', ['Ht', (0.80, 0.93, -1.995), 'Tc'])
    Q('Hg0', (0.862, 0.962, -0.72))
    Q('Hg1', (0.80, 0.946, -1.70))
    E('h_split', ['Hg0', 'Hc', (0.84, 0.95, -1.6), 'Hg1'], kind='soft')
    F('haunch', ['shut_up', 'shoulder', 'tail_top', 'deck_rear', 'bay_edge', 'frame_r', 'g_rear'], crown=0.004, hint=(0.6, 1, 0),
      guides=['h_split'])

    # tail: deck drop, lamp band, exhaust, blade, diffuser; flat across the centre, swept back at the sides
    Q('Tt0', (0.0, 0.955, -2.08))
    Q('Tb0', (0.0, 0.868, zb(0.0)))
    Q('Tk0', (KX, 0.868, zb(KX)))
    Q('Tb1', (0.872, 0.888, zb(0.872)))
    Q('Tb2', (0.865, 0.615, zb(0.865) - 0.004))
    Q('Tk3', (KX, 0.615, zb(KX) - 0.012))
    Q('Tb3', (0.0, 0.615, zb(0.0) - 0.02))
    E('deck_end', ['Bk0', 'Tt0'])
    E('deck_tail', ['Bk0', (0.15, 0.955, -1.97), 'Bk'])
    E('tail_ctr', ['Tt0', 'Tb0'])
    E('tail_top2', ['Tt0', (0.4, 0.95, -2.06), 'Ht'])
    E('tc_down', ['Tc', (0.905, 0.897, -2.04), 'Tb1'])
    E('band_top', ['Tb0', (0.22, 0.868, zb(0.22)), 'Tk0'])
    E('band_top_s', ['Tk0', (0.65, 0.878, zb(0.65)), 'Tb1'])
    F('rear_deck', ['deck_tail', 'deck_rear', 'tail_top2', 'deck_end'], hint=(0, 1, -0.2))
    F('tail_up', ['tail_top2', 'tail_top', 'tc_down', 'band_top_s', 'band_top', 'tail_ctr'], crown=0.004, hint=(0, 0.6, -1))
    hx = [(0.033, 0.80), (0.090, 0.855), (0.266, 0.855), (0.323, 0.80), (0.266, 0.745), (0.090, 0.745)]
    for i, (x, y) in enumerate(hx):
        Q(f'X{i}', (x, y, -2.426 + 0.01 * x))
    for i in range(6):
        E(f'hex{i}', [f'X{i}', f'X{(i + 1) % 6}'])
    lp = [(0.452, 0.83), (0.862, 0.868), (0.862, 0.722), (0.452, 0.735)]
    for i, (x, y) in enumerate(lp):
        Q(f'L{i}', (x, y, zb(x) - 0.002 - 0.012 * (0.83 - y) / 0.1))
    for i in range(4):
        E(f'tl{i}', [f'L{i}', f'L{(i + 1) % 4}'])
    E('band_end', ['Tb1', 'Tb2'])
    E('band_bot', ['Tb3', (0.22, 0.615, zb(0.22) - 0.018), 'Tk3'])
    E('band_bot_s', ['Tk3', (0.65, 0.615, zb(0.65) - 0.008), 'Tb2'])
    E('band_ctr', ['Tb0', 'Tb3'])
    E('band_k', ['Tk0', 'Tk3'])
    F('band', ['band_top', 'band_k', 'band_bot', 'band_ctr'], hint=(0, 0, -1), holes=[[f'hex{i}' for i in range(6)]])
    F('band_s', ['band_top_s', 'band_end', 'band_bot_s', 'band_k'], hint=(0.6, 0, -1), holes=[[f'tl{i}' for i in range(4)]])
    recess(n, 'exh', [f'hex{i}' for i in range(6)], (0.0, 0.0, 0.18), hint=(0, 0, -1))
    recess(n, 'tlamp', [f'tl{i}' for i in range(4)], (-0.035, 0.0, 0.05), hint=(0.6, 0, -1))

    Q('Bb0', (0.0, 0.600, -2.474))
    Q('Bq0', (KX, 0.600, -2.466))
    Q('Bb1', (0.86, 0.600, zp(0.86)))
    Q('Bb2', (0.86, 0.535, zp(0.86)))
    Q('Bq3', (KX, 0.535, -2.466))
    Q('Bb3', (0.0, 0.535, -2.474))
    E('blade_top_c', ['Tb3', 'Bb0'])
    E('blade_top_e', ['Tb2', 'Bb1'])
    E('blade_le', ['Bb0', (0.22, 0.60, -2.472), 'Bq0'])
    E('blade_le_s', ['Bq0', (0.65, 0.60, zp(0.65)), 'Bb1'])
    E('blade_lo', ['Bb3', (0.22, 0.535, -2.472), 'Bq3'])
    E('blade_lo_s', ['Bq3', (0.65, 0.535, zp(0.65)), 'Bb2'])
    E('blade_c', ['Bb0', 'Bb3'])
    E('blade_e', ['Bb1', 'Bb2'])
    E('blade_k', ['Bq0', 'Bq3'])
    E('bt_k', ['Tk3', 'Bq0'])
    F('blade_top', ['band_bot', 'bt_k', 'blade_le', 'blade_top_c'], hint=(0, 1, -0.2))
    F('blade_top_s', ['band_bot_s', 'blade_top_e', 'blade_le_s', 'bt_k'], hint=(0.3, 1, -0.2))
    F('blade_face', ['blade_le', 'blade_k', 'blade_lo', 'blade_c'], hint=(0, 0, -1))
    F('blade_face_s', ['blade_le_s', 'blade_e', 'blade_lo_s', 'blade_k'], hint=(0.6, 0, -1))
    Q('Df0', (0.0, 0.51, -2.43))
    Q('Dq', (KX, 0.51, -2.42))
    Q('Df1', (0.84, 0.51, zp(0.84) + 0.03))
    Q('Df2', (0.0, 0.12, -1.85))
    Q('Df3', (0.80, 0.12, -1.85))
    E('blade_under_c', ['Bb3', 'Df0'])
    E('blade_under_e', ['Bb2', 'Df1'])
    E('bu_k', ['Bq3', 'Dq'])
    E('dif_top', ['Df0', (0.22, 0.51, -2.428), 'Dq'])
    E('dif_top_s', ['Dq', (0.65, 0.51, zp(0.65) + 0.03), 'Df1'])
    E('dif_ctr', ['Df0', (0.0, 0.30, -2.20), 'Df2'])
    E('dif_side', ['Df1', (0.82, 0.33, -2.0), 'Df3'])
    E('dif_front', ['Df2', 'Df3'])
    F('blade_under', ['blade_lo', 'bu_k', 'dif_top', 'blade_under_c'], hint=(0, -1, 0), mat='black')
    F('blade_under_s', ['blade_lo_s', 'blade_under_e', 'dif_top_s', 'bu_k'], hint=(0.3, -1, 0), mat='black')
    F('diffuser', ['dif_top', 'dif_top_s', 'dif_side', 'dif_front', 'dif_ctr'], hint=(0, -0.6, -1), mat='dark')

    # rear corner closing the side to the tail, dark strake below it
    Q('Rlo', (0.965, 0.40, -1.975))
    Q('Rk', arc(RH, -30, 0.975))
    Q('Rq', (0.93, 0.38, -2.03))
    E('rc_low', ['Rb', (0.978, 0.40, -1.94), 'Rlo'])
    E('rc_dif', ['Rlo', (0.91, 0.47, -2.07), 'Df1'])
    E('arch_r_low', ['Rb', arc(RH, -12, 0.982), 'Rk'])
    E('rdif_bot', ['Rk', (0.955, 0.24, -1.95), 'Rq'])
    E('rdif_back', ['Rq', 'Df1'])
    E('df3_rk', ['Df3', 'Rk'])
    F('rear_low', ['arch_r_low', 'rdif_bot', 'rdif_back', 'rc_dif', 'rc_low'], mat='black', hint=(1, 0, -0.3))
    F('strake_in', ['rdif_bot', 'rdif_back', 'dif_side', 'df3_rk'], mat='black', hint=(-1, -0.3, 0))
    E('rc_mid', ['Rm', (0.918, 0.618, -2.045), 'Tb2'])
    F('rear_corner', ['rear_side_up', 'tc_down', 'band_end', 'rc_mid'], crown=0.004, hint=(1, 0, -1))
    E('blade_end', ['Df1', 'Tb2'])
    F('blade_cap', ['blade_top_e', 'blade_e', 'blade_under_e', 'blade_end'], mat='black', hint=(1, 0, 0))
    F('rear_corner_low', ['rear_side', 'rc_mid', 'blade_end', 'rc_dif', 'rc_low'], mat='black', hint=(1, 0, -1))
    return n
