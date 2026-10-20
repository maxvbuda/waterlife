"""Builds Waterlife's 3D creature models in FreeCAD and exports them as .glb files.

Run it inside the FreeCAD GUI, either from the Python console or through the MCP:

    import runpy
    runpy.run_path('/path/to/waterlife/models/build_models.py')

To rebuild only some creatures:

    runpy.run_path('.../build_models.py', init_globals={'ONLY': ['octopus', 'clownfish']})

Each creature is written to models/<id>.glb next to this file. Ids match SPECIES in
js/creatures.js, plus 'octopus' for the player.

Conventions: millimetres, creatures face +X, Z is up. glTF export turns Z-up into
Y-up, so the creature's -Y side ends up facing the web viewer's camera.
"""

import math
import os
import random

import FreeCAD as App
import Part
from FreeCAD import Vector as V

OUT = os.path.dirname(os.path.abspath(__file__))
ONLY = globals().get('ONLY')
DEVIATION = 1.0       # mesh coarseness in percent of object size; higher = smaller files
ANGULAR = 28          # max angle between mesh facets, in degrees
# Parts made of many tiny pieces (suckers, teeth, bumps...) are meshed much more coarsely.
SMALL_PARTS = ('Sucker', 'Teeth', 'Spines', 'Bumps', 'Papillae', 'Lights', 'LightCups', 'Facets', 'Joints', 'Glints',
               'Specks', 'Knobs', 'Cirri', 'Tentacles', 'Rays', 'Scale', 'Flecks', 'Seams', 'Rings', 'Lateral', 'Spots',
               'Lappets', 'Filaments', 'Tassels', 'TailFin', 'Antennae', 'Legs', 'Rims', 'Crown', 'Blotches')


# ---------------------------------------------------------------------------
# Shape helpers
# ---------------------------------------------------------------------------

def ellipsoid(c, rx, ry, rz, rot=()):
    s = Part.makeSphere(1.0)
    m = App.Matrix()
    m.scale(rx, ry, rz)
    s = s.transformGeometry(m)
    for axis, deg in rot:
        s.rotate(V(0, 0, 0), V(*axis), deg)
    s.translate(V(*c))
    return s


def sphere(c, r):
    return Part.makeSphere(r, V(*c))


TAU = math.pi * 2


def lerp_list(vals, u):
    f = u * (len(vals) - 1)
    i = min(int(f), len(vals) - 2)
    t = f - i
    return vals[i] + (vals[i + 1] - vals[i]) * t


def tube(points, radii, n=None):
    """Round, tapering tube along a smooth curve through `points`.

    Rings are carried along the curve without spinning (parallel transport), so long
    curly tubes loft cleanly.
    """
    pts = [V(*p) for p in points]
    bs = Part.BSplineCurve()
    bs.interpolate(pts)
    n = n or max(6, len(points) * 3)
    a, b = bs.FirstParameter, bs.LastParameter
    secs = []
    normal = None
    for k in range(n + 1):
        u = k / n
        prm = a + (b - a) * u
        c = bs.value(prm)
        t = bs.tangent(prm)[0]
        if normal is None:
            ref = V(0, 0, 1) if abs(t.z) < 0.9 else V(1, 0, 0)
            normal = ref.cross(t)
        normal = normal - t * normal.dot(t)
        normal.normalize()
        binormal = t.cross(normal)
        r = max(lerp_list(radii, u), 0.15)
        ring = [c + (normal * math.cos(TAU * j / 16) + binormal * math.sin(TAU * j / 16)) * r for j in range(16)]
        curve = Part.BSplineCurve()
        curve.interpolate(ring, PeriodicFlag=True)
        secs.append(Part.Wire(curve.toShape()))
    return Part.makeLoft(secs, True, False)


def scaled(shape, k, center=(0, 0, 0)):
    s = shape.copy()
    s.translate(V(*center) * -1)
    m = App.Matrix()
    m.scale(k, k, k)
    s = s.transformGeometry(m)
    s.translate(V(*center))
    return s


def below(shape, k, z, center=(0, 0, 0)):
    """Slightly enlarged part of `shape` under height z, used for pale bellies."""
    return scaled(shape, k, center).common(Part.makeBox(400, 400, 200, V(-200, -200, z - 200)))


# ---------------------------------------------------------------------------
# Detailed-anatomy helpers
# ---------------------------------------------------------------------------

def profile(ctrl):
    """Piecewise-linear curve through (u, value) control points."""
    def f(u):
        if u <= ctrl[0][0]:
            return ctrl[0][1]
        for (u0, v0), (u1, v1) in zip(ctrl, ctrl[1:]):
            if u <= u1:
                return v0 + (v1 - v0) * (u - u0) / (u1 - u0)
        return ctrl[-1][1]
    return f


BODY_U = [0, 0.012, 0.035, 0.07, 0.12, 0.18, 0.26, 0.35, 0.45, 0.55, 0.65, 0.74, 0.82, 0.89, 0.95, 1.0]


def body_section(x, top, bot, w, keel=0.0, square=0.0, n=28):
    """Cross-section at x. `square` > 0 makes it boxier, `keel` pinches the belly into a ridge."""
    zc, rz = (top + bot) / 2, max((top - bot) / 2, 0.2)
    e = 1.0 / (1.0 + square)
    pts = []
    for j in range(n):
        t = TAU * j / n
        ct, st = math.cos(t), math.sin(t)
        cy = math.copysign(abs(st) ** e, st)
        cz = math.copysign(abs(ct) ** e, ct)
        y = max(w, 0.2) * cy
        if ct < 0:
            y *= 1 - keel * (-ct) ** 1.5
        pts.append(V(x, y, zc + rz * cz))
    bs = Part.BSplineCurve()
    bs.interpolate(pts, PeriodicFlag=True)
    return Part.Wire(bs.toShape())


class Body:
    """A creature body lofted from side-view top/bottom outlines and a width curve.

    Outlines are (u, value) pairs where u runs from the nose (0) to the tail (1) and
    values are fractions of the length L. The nose points to +X, at x = L/2.
    """

    def __init__(self, L, top, bot, wid, keel=0.0, square=0.0, us=BODY_U):
        self.L = L
        self.T, self.B, self.W = profile(top), profile(bot), profile(wid)
        self.shape = Part.makeLoft(
            [body_section(L / 2 - u * L, self.T(u) * L, self.B(u) * L, self.W(u) * L, keel, square) for u in us], True, False)
        self.center = (0, 0, (self.T(0.45) + self.B(0.45)) * L / 2)

    def u(self, x):
        return (self.L / 2 - x) / self.L

    def top(self, x):
        return self.T(self.u(x)) * self.L

    def bot(self, x):
        return self.B(self.u(x)) * self.L

    def hw(self, x, z=None):
        w = self.W(self.u(x)) * self.L
        if z is None:
            return w
        zc, rz = (self.top(x) + self.bot(x)) / 2, (self.top(x) - self.bot(x)) / 2
        return w * math.sqrt(max(0.0, 1 - ((z - zc) / rz) ** 2))


def closed_curve(pts):
    bs = Part.BSplineCurve()
    bs.interpolate(pts, PeriodicFlag=True)
    return Part.Wire(bs.toShape())


def fin_plate(outline, thick=1.6, plane='xz', edge=0.8):
    """A smooth fin from a 2D outline, thickest in the middle and tapering to a rounded edge."""
    cx = sum(a for a, _ in outline) / len(outline)
    cz = sum(b for _, b in outline) / len(outline)
    def wire(k, off):
        pts = []
        for a, b in outline:
            a2, b2 = cx + (a - cx) * k, cz + (b - cz) * k
            pts.append(V(a2, off, b2) if plane == 'xz' else V(a2, b2, off))
        return closed_curve(pts)
    return Part.makeLoft([wire(edge, -thick / 2), wire(1.0, 0), wire(edge, thick / 2)], True, False)


def edged_fin(outline, root, thick=1.6, margin=0.86, plane='xz'):
    """Returns (edge, inner) fins: a dark rim with the main fin color inset toward its root."""
    rx, rz = root
    inner = [(rx + (a - rx) * margin, rz + (b - rz) * margin) for a, b in outline]
    return fin_plate(outline, thick, plane), fin_plate(inner, thick * 1.35, plane)


def fin_rays(root, tips, thick, r=0.28, plane='xz'):
    """Thin raised rays running from a fin's root out toward its edge, on both faces."""
    rays = []
    for side in (-1, 1):
        off = side * thick * 0.36
        for a, b in tips:
            p0 = V(root[0], off, root[1]) if plane == 'xz' else V(root[0], root[1], off)
            p1 = V(root[0] + (a - root[0]) * 0.78, off, root[1] + (b - root[1]) * 0.78) if plane == 'xz' else \
                V(root[0] + (a - root[0]) * 0.78, root[1] + (b - root[1]) * 0.78, off)
            if (p1 - p0).Length > 1:
                rays.append(Part.makeCylinder(r, (p1 - p0).Length, p0, p1 - p0))
    return Part.makeCompound(rays)


def placed(shape, rot=(), move=(0, 0, 0)):
    s = shape.copy()
    for axis, deg in rot:
        s.rotate(V(0, 0, 0), V(*axis), deg)
    s.translate(V(*move))
    return s


def mirrored_pair(shape):
    """The shape plus its mirror image across the XZ plane (for left/right fins)."""
    return Part.makeCompound([shape, shape.mirror(V(0, 0, 0), V(0, 1, 0))])


def fish_eyes(body, x, z, r, iris='#c8a040', pupil='#080808', rim=None):
    """Eyes set into the body surface: a socket rim, colored iris, pupil and a highlight."""
    rims, irises, pupils, glints = [], [], [], []
    for side in (-1, 1):
        y = side * (body.hw(x, z) - r * 0.3)
        c = V(x, y, z)
        d = V(0, side, 0)
        rims.append(Part.makeTorus(r * 1.02, r * 0.22, c + d * (r * 0.25), d))
        irises.append(Part.makeSphere(r, c))
        pupils.append(Part.makeSphere(r * 0.6, c + d * (r * 0.5)))
        glints.append(Part.makeSphere(r * 0.17, c + V(r * 0.3, side * r * 0.98, r * 0.38)))
    out = [('Irises', Part.makeCompound(irises), iris), ('Pupils', Part.makeCompound(pupils), pupil),
           ('Glints', Part.makeCompound(glints), '#ffffff')]
    if rim:
        out.insert(0, ('EyeRims', Part.makeCompound(rims), rim))
    return out


def band(shape, k, x, half, tilt=0.0, center=(0, 0, 0)):
    """A slightly enlarged stripe of `shape` around x, optionally slanted."""
    box = Part.makeBox(2 * half, 400, 400, V(-half, -200, -200))
    box.rotate(V(0, 0, 0), V(0, 1, 0), tilt)
    box.translate(V(x, 0, 0))
    return scaled(shape, k, center).common(box)


def stripe(shape, k, p, angle, half, x0, x1, center=(0, 0, 0)):
    """A thin enlarged line of `shape` through point p=(x, z) at `angle` degrees, kept between x0 and x1."""
    box = Part.makeBox(400, 400, 2 * half, V(-200, -200, -half))
    box.rotate(V(0, 0, 0), V(0, 1, 0), -angle)
    box.translate(V(p[0], 0, p[1]))
    return scaled(shape, k, center).common(box).common(Part.makeBox(x1 - x0, 400, 400, V(x0, -200, -200)))


def above(shape, k, z, center=(0, 0, 0)):
    return scaled(shape, k, center).common(Part.makeBox(400, 400, 200, V(-200, -200, z)))


# ---------------------------------------------------------------------------
# Creatures. Each returns a list of (part name, shape, hex color).
# ---------------------------------------------------------------------------

def ring(c, nrm, bnm, r, n=16):
    pts = [c + (nrm * math.cos(TAU * j / n) + bnm * math.sin(TAU * j / n)) * r for j in range(n)]
    bs = Part.BSplineCurve()
    bs.interpolate(pts, PeriodicFlag=True)
    return Part.Wire(bs.toShape())


def cephalopod_arm(theta, reach, curl, yaw, pitch0, r0=8.4, n=18, base_r=10, base_z=-2, suckers=True):
    """A muscular arm that leaves the body along `theta`, droops, then rolls its tip into a curl.

    The arm's heading is integrated step by step, so `curl` controls how tightly the tip
    rolls up and `yaw` how much it sweeps sideways. Suckers sit in two staggered rows on
    the underside (the oral side), shrinking toward the tip.
    """
    rad = V(math.cos(theta), math.sin(theta), 0)
    up = V(0, 0, 1)
    side = up.cross(rad)
    p = rad * base_r + V(0, 0, base_z)
    pitch = pitch0
    pts, frames, radii = [], [], []
    step = reach / n
    for k in range(n + 1):
        u = k / n
        h = rad * math.cos(pitch) + up * math.sin(pitch) + side * (yaw * u * 1.6)
        h.normalize()
        oral = (up * math.cos(pitch) - rad * math.sin(pitch)) * -1
        oral = oral - h * oral.dot(h)
        oral.normalize()
        pts.append(V(p))
        frames.append((h, oral))
        radii.append(r0 * (1 - u) ** 1.25 + 0.55)
        p = p + h * step
        pitch += (0.35 + curl * 11 * u ** 2.6) / n
    body = Part.makeLoft([ring(c, o, h.cross(o), r) for c, (h, o), r in zip(pts, frames, radii)], True, False)
    rims, cups = [], []
    if suckers:
        for k in range(1, n):
            for sgn, half in ((-1, 0.0), (1, 0.5)):
                cc = pts[k] + (pts[k + 1] - pts[k]) * half
                rr = radii[k] + (radii[k + 1] - radii[k]) * half
                h, oral = frames[k]
                d = oral * math.cos(0.42) + h.cross(oral) * (sgn * math.sin(0.42))
                sr = rr * 0.36
                base = cc + d * (rr * 0.88)
                rims.append(Part.makeTorus(sr, sr * 0.34, base, d))
                cups.append(Part.makeCylinder(sr * 0.85, sr * 0.2, base - d * (sr * 0.1), d))
    return body, rims, cups, pts


def curve_frames(points, n):
    """Points along a smooth curve with a twist-free frame: (point, tangent, normal, binormal, u)."""
    bs = Part.BSplineCurve()
    bs.interpolate([V(*p) for p in points])
    a, b = bs.FirstParameter, bs.LastParameter
    out, normal = [], None
    for k in range(n + 1):
        u = k / n
        prm = a + (b - a) * u
        t = bs.tangent(prm)[0]
        if normal is None:
            ref = V(0, 1, 0) if abs(t.y) < 0.9 else V(1, 0, 0)
            normal = ref.cross(t)
        normal = normal - t * normal.dot(t)
        normal.normalize()
        out.append((bs.value(prm), t, normal, t.cross(normal), u))
    return out


def ribbon(points, w, t, twist=0.0, n=24):
    """A flat, frilly strip along a curve (width w, thickness t) that can twist as it goes."""
    secs = []
    for c, tg, nrm, bnm, u in curve_frames(points, n):
        a = twist * u
        nn = nrm * math.cos(a) + bnm * math.sin(a)
        bb = tg.cross(nn)
        width = lerp_list(w, u) if isinstance(w, (list, tuple)) else w
        pts = [c + nn * (width * math.cos(TAU * j / 16)) + bb * (t * math.sin(TAU * j / 16)) for j in range(16)]
        secs.append(closed_curve(pts))
    return Part.makeLoft(secs, True, False)


def jointed_leg(points, radii, joint_color_shapes):
    """A leg through hip -> knee -> ankle -> tip with a bulge at each joint."""
    leg = tube(points, radii, n=len(points) * 4)
    for p, r in zip(points[1:-1], radii[1:-1]):
        joint_color_shapes.append(Part.makeSphere(r * 1.25, V(*p)))
    return leg


def as_along_x(shape):
    """Turn something built hanging down (-Z) so that it trails backward (-X)."""
    s = shape.copy()
    s.rotate(V(0, 0, 0), V(0, 1, 0), 90)
    return s


def octopus():
    rng = random.Random(7)
    # (direction from the front in degrees, reach, curl, sideways sweep, starting pitch)
    specs = [(22, 66, 1.45, 0.25, -0.75), (67, 80, 0.9, -0.1, -0.45), (112, 76, 1.1, 0.15, -0.6),
             (157, 64, 0.8, -0.1, -1.05), (202, 66, 0.9, 0.12, -1.05), (247, 74, 1.0, -0.15, -0.6),
             (292, 82, 0.85, 0.1, -0.45), (337, 64, 1.55, -0.25, -0.8)]
    arms, rims, cups = [], [], []
    for deg, reach, curl, yaw, p0 in specs:
        b, r, c, _ = cephalopod_arm(math.radians(deg - 90), reach, curl, yaw, p0)
        arms.append(b)
        rims += r
        cups += c

    # webbing: a skirt that flares out between the arm bases
    def scallop(z, rmin, rmax, n=64):
        pts = []
        for j in range(n):
            a = TAU * j / n
            lobe = 0.5 + 0.5 * math.cos(8 * (a - math.radians(22 - 90)))
            r = rmin + (rmax - rmin) * lobe
            pts.append(V(r * math.cos(a), r * math.sin(a), z - 3.5 * lobe))
        bs = Part.BSplineCurve()
        bs.interpolate(pts, PeriodicFlag=True)
        return Part.Wire(bs.toShape())
    web = Part.makeLoft([Part.Wire(Part.makeCircle(15.5, V(0, 0, 1), V(0, 0, 1))), scallop(-6, 17, 21), scallop(-10, 18.5, 25.5)], True, False)

    # mantle tilted back, a head with raised eye mounds and brow ridges
    body = ellipsoid((0, 6, 36), 20, 22, 29, rot=[((1, 0, 0), -22)])
    for extra in [ellipsoid((0, -2, 8), 18, 18, 12), ellipsoid((0, 0, -1), 16.5, 16.5, 8)] + \
                 [ellipsoid((s * 10.5, -13, 15), 7.5, 7, 7) for s in (-1, 1)] + \
                 [ellipsoid((s * 10.5, -12.5, 20.5), 6.5, 5, 2.6, rot=[((0, 1, 0), s * -12)]) for s in (-1, 1)]:
        body = body.fuse(extra)

    sp = [V(15, -6, 4), V(19, -10, 1.5), V(21, -13, 0.5)]
    bs = Part.BSplineCurve()
    bs.interpolate(sp)
    siphon = Part.Wire(bs.toShape()).makePipeShell([Part.Wire(Part.makeCircle(2.6, sp[0], bs.tangent(bs.FirstParameter)[0]))], True, True)

    # skin bumps (papillae) and darker blotches on the mantle
    papillae = []
    tilt = App.Rotation(V(1, 0, 0), -22)
    while len(papillae) < 60:
        th, ph = rng.uniform(0, TAU), math.acos(rng.uniform(-0.15, 1))
        q = tilt.multVec(V(math.sin(ph) * math.cos(th) * 20, math.sin(ph) * math.sin(th) * 22, math.cos(ph) * 29)) + V(0, 6, 36)
        if q.y < -12 and q.z < 26:
            continue
        papillae.append(Part.makeSphere(rng.uniform(0.7, 1.6), q))
    blotches = [ellipsoid(c, 3, 3, 3) for c in [(9, -11, 42), (-11, -9, 36), (4, -16, 31), (-3, -10, 52), (14, -3, 50)]]

    # gold eyes with the horizontal slit pupils octopuses are known for
    irises, pupils, glints = [], [], []
    for s in (-1, 1):
        c = V(s * 10.5, -18.2, 15.5)
        irises.append(Part.makeSphere(4.6, c))
        pupils.append(ellipsoid(c + V(0, -4.15, 0.2), 3.3, 0.9, 1.05))
        glints.append(Part.makeSphere(0.85, c + V(s * -1.5, -4.0, 2.0)))

    return [
        ('Body', body, '#d9492f'),
        ('Web', web, '#cf4630'),
        ('Arms', Part.makeCompound(arms), '#d9492f'),
        ('Siphon', siphon, '#d24530'),
        ('SuckerRims', Part.makeCompound(rims), '#f6d3b8'),
        ('SuckerCups', Part.makeCompound(cups), '#e9a98c'),
        ('Papillae', Part.makeCompound(papillae), '#c23d27'),
        ('Blotches', Part.makeCompound(blotches), '#a8321f'),
        ('Irises', Part.makeCompound(irises), '#e8b23a'),
        ('Pupils', Part.makeCompound(pupils), '#141414'),
        ('Glints', Part.makeCompound(glints), '#ffffff'),
    ]


def clownfish():
    orange, black, white = '#ff7417', '#151515', '#fbfbf6'
    b = Body(100,
             top=[(0, 0.02), (0.035, 0.09), (0.1, 0.17), (0.2, 0.245), (0.35, 0.285), (0.5, 0.28), (0.65, 0.225), (0.78, 0.15), (0.9, 0.095), (1, 0.085)],
             bot=[(0, -0.025), (0.035, -0.075), (0.1, -0.14), (0.2, -0.2), (0.35, -0.235), (0.5, -0.23), (0.65, -0.18), (0.78, -0.115), (0.9, -0.075), (1, -0.07)],
             wid=[(0, 0.03), (0.06, 0.085), (0.18, 0.13), (0.35, 0.15), (0.55, 0.135), (0.75, 0.09), (0.9, 0.05), (1, 0.035)])
    body, c = b.shape, b.center
    # three white bars with thin black borders; the head bar curves back behind the eye
    edges = [band(body, 1.025, 25, 5.6, 8, c), band(body, 1.025, -6, 6.4, -6, c), band(body, 1.025, -41, 4.6, 0, c)]
    bars = [band(body, 1.04, 25, 4.0, 8, c), band(body, 1.04, -6, 4.8, -6, c), band(body, 1.04, -41, 3.0, 0, c)]

    def top(x):
        return b.top(x)
    dorsal = [(30, top(30) - 3), (26, top(26) + 7), (18, top(18) + 11), (10, top(10) + 11), (3, top(3) + 8), (-3, top(-3) + 7),
              (-10, top(-10) + 14), (-20, top(-20) + 16), (-31, top(-31) + 12), (-39, top(-39) + 3), (-40, top(-40) - 3)]
    anal = [(-14, b.bot(-14) + 3), (-18, b.bot(-18) - 11), (-27, b.bot(-27) - 14), (-36, b.bot(-36) - 8), (-40, b.bot(-40) + 3)]
    caudal = [(-46, 7), (-55, 15), (-64, 16), (-71, 10), (-73, 0), (-71, -10), (-64, -16), (-55, -15), (-46, -7)]
    d_edge, d_in = edged_fin(dorsal, (0, top(0) - 3))
    a_edge, a_in = edged_fin(anal, (-27, b.bot(-27) + 2))
    c_edge, c_in = edged_fin(caudal, (-47, 0), thick=1.4, margin=0.84)
    rays = Part.makeCompound([fin_rays((-47, 0), caudal[1:-1], 1.4 * 1.35),
                              fin_rays((-12, top(-12) - 2), dorsal[6:10], 1.6 * 1.35)])

    pect_outline = [(0, 0), (-4, 7), (-13, 9), (-20, 4), (-21, -2), (-15, -6), (-5, -4)]
    pe, pi = edged_fin(pect_outline, (0, 0), thick=1.2, margin=0.8)
    pects_edge, pects_in = [], []
    for side in (-1, 1):
        rot = [((1, 0, 0), side * -12), ((0, 0, 1), side * 30)]
        mv = (24, side * (b.hw(24, -6) - 0.5), -6)
        pects_edge.append(placed(pe, rot, mv))
        pects_in.append(placed(pi, rot, mv))
    pelvic = fin_plate([(0, 0), (-6, -9), (-11, -10), (-8, -2)], 1.0)
    pelvics = [placed(pelvic, [((1, 0, 0), side * -18)], (14, side * 5, b.bot(14) + 3)) for side in (-1, 1)]

    lips = ellipsoid((49.5, 0, -3.2), 2.2, 3.4, 1.6)
    return [
        ('Body', body, orange),
        ('BarEdges', Part.makeCompound(edges), black),
        ('Bars', Part.makeCompound(bars), white),
        ('FinEdges', Part.makeCompound([d_edge, a_edge, c_edge] + pects_edge), black),
        ('Fins', Part.makeCompound([d_in, a_in, c_in] + pects_in), orange),
        ('FinRays', rays, '#e45f0a'),
        ('Pelvics', Part.makeCompound(pelvics), '#2a1a12'),
        ('Lips', lips, '#f26a12'),
    ] + fish_eyes(b, 37, 6.5, 5.4, iris='#c25a12', rim='#e86410')


def seahorse():
    gold, dark = '#f0ad37', '#c9811d'
    path = [(1.5, 0, 33), (-4, 0, 21), (2, 0, 8), (6, 0, -4), (2, 0, -15), (-4, 0, -23), (-6, 0, -31), (-2, 0, -37), (4, 0, -36), (4.5, 0, -30), (1, 0, -29)]
    rads = [5.8, 7.2, 9.5, 9.5, 7.5, 5.6, 4.2, 3.3, 2.7, 2.1, 1.7]
    body = tube(path, rads, n=44)
    # bony rings and the little knobs along the back
    rings, knobs = [], []
    for c, t, nrm, bnm, u in curve_frames(path, 24)[2:-1]:
        r = lerp_list(rads, u)
        rings.append(Part.makeTorus(r * 0.99, max(r * 0.045, 0.16), c, t))
        back = V(-1, 0, 0) - t * V(-1, 0, 0).dot(t)
        if back.Length > 0.1:
            back.normalize()
            knobs.append(Part.makeSphere(max(r * 0.16, 0.4), c + back * r * 1.02))
    head = ellipsoid((2, 0, 34), 8, 6, 6.5)
    snout = tube([(6, 0, 35), (13, 0, 33.5), (20, 0, 32.2)], [2.9, 2.2, 2.5])
    crown = [Part.makeCone(2.6, 0.9, 5, V(0, 0, 38), V(-0.2, 0, 1))]
    for i in range(5):
        a = TAU * i / 5
        crown.append(Part.makeCone(0.8, 0.1, 2.6, V(-1 + math.cos(a) * 1.6, math.sin(a) * 1.6, 42.4), V(math.cos(a) * 0.4, math.sin(a) * 0.4, 1)))
    cheek_spines = [Part.makeCone(0.7, 0.1, 2.4, V(-3, side * 4.6, 31), V(-0.5, side * 0.6, 0.2)) for side in (-1, 1)]
    pouch = ellipsoid((7.5, 0, -7), 5, 6.8, 7.5)
    dorsal = fin_plate([(-7, -8), (-12, -6), (-16, 0), (-14, 7), (-8, 9)], 0.9)
    rays = fin_rays((-6, 0), [(-12, -6), (-15, -3), (-16, 0), (-15.5, 3.5), (-14, 7)], 0.9, r=0.18)
    pect = fin_plate([(0, 0), (-3, 2.5), (-6, 1), (-5, -2)], 0.6)
    pects = [placed(pect, [((0, 0, 1), side * 20)], (-1, side * 6.5, 30)) for side in (-1, 1)]
    rng = random.Random(5)
    specks = []
    for c, t, nrm, bnm, u in curve_frames(path, 30)[2:-6]:
        r = lerp_list(rads, u)
        for _ in range(2):
            a = rng.uniform(0, TAU)
            specks.append(Part.makeSphere(r * 0.08 + 0.15, c + (nrm * math.cos(a) + bnm * math.sin(a)) * r))
    return [
        ('Body', body.fuse(head).fuse(pouch), gold),
        ('Snout', snout, gold),
        ('Rings', Part.makeCompound(rings), '#d99a2c'),
        ('Knobs', Part.makeCompound(knobs + cheek_spines), dark),
        ('Crown', Part.makeCompound(crown), '#d8901f'),
        ('Specks', Part.makeCompound(specks), '#fff2c8'),
        ('Dorsal', dorsal, '#ffe0a0'),
        ('DorsalRays', rays, '#e8b04a'),
        ('Pectorals', Part.makeCompound(pects), '#ffe0a0'),
        ('Eyes', Part.makeCompound([sphere((4.5, side * 5.0, 35), 2.2) for side in (-1, 1)]), '#2b1a08'),
        ('EyeRims', Part.makeCompound([Part.makeTorus(2.3, 0.5, V(4.5, side * 5.0, 35), V(0, side, 0)) for side in (-1, 1)]), dark),
        ('Glints', Part.makeCompound([sphere((5.2, side * 7.0, 35.8), 0.45) for side in (-1, 1)]), '#ffffff'),
    ]


def seastar():
    orange = '#e8622c'
    arms = []
    bumps, spines = [], []
    for i in range(5):
        a = 90 + i * 72
        secs = []
        for d, w, h, lift in ((0, 11, 7, 0), (10, 8.5, 6, 0), (20, 6.2, 4.6, 0.4), (30, 4.2, 3.3, 1.4), (38, 2.4, 2.2, 3.0), (43, 0.9, 0.9, 4.6)):
            secs.append(body_section(d, lift + h, lift - h * 0.35, w, square=0.2))
        arm = Part.makeLoft(secs, True, False)
        arm.rotate(V(0, 0, 0), V(0, 0, 1), a)
        arms.append(arm)
        rad = math.radians(a)
        dirv, perp = V(math.cos(rad), math.sin(rad), 0), V(-math.sin(rad), math.cos(rad), 0)
        for d in range(6, 40, 4):
            w = lerp_list([11, 8.5, 6.2, 4.2, 2.4], d / 40)
            h = lerp_list([7, 6, 4.6, 3.3, 2.2], d / 40)
            lift = lerp_list([0, 0, 0.4, 1.4, 3.0], d / 40)
            spines.append(Part.makeSphere(max(h * 0.2, 0.6), dirv * d + V(0, 0, lift + h - 0.2)))
            for side in (-1, 1):
                p = dirv * (d + 2) + perp * (side * w * 0.6) + V(0, 0, lift + h * 0.72)
                bumps.append(Part.makeSphere(max(h * 0.14, 0.45), p))
    disc = ellipsoid((0, 0, 0), 15, 15, 7.4)
    madreporite = Part.makeCylinder(2.2, 0.8, V(5, 3, 6.9), V(0, 0, 1))
    return [
        ('Body', Part.makeCompound(arms + [disc]), orange),
        ('Spines', Part.makeCompound(spines), '#ffb070'),
        ('Bumps', Part.makeCompound(bumps), '#f58a4a'),
        ('Madreporite', madreporite, '#f6d06c'),
    ]


def parrotfish():
    teal, pink, beak = '#1fb49f', '#ff7fae', '#e3f6f1'
    b = Body(100,
             top=[(0, 0.04), (0.04, 0.12), (0.1, 0.19), (0.2, 0.24), (0.35, 0.255), (0.55, 0.24), (0.72, 0.18), (0.85, 0.11), (0.94, 0.08), (1, 0.075)],
             bot=[(0, -0.04), (0.04, -0.1), (0.1, -0.15), (0.2, -0.19), (0.35, -0.205), (0.55, -0.19), (0.72, -0.14), (0.85, -0.085), (0.94, -0.065), (1, -0.06)],
             wid=[(0, 0.04), (0.06, 0.09), (0.2, 0.13), (0.4, 0.135), (0.7, 0.09), (0.9, 0.045), (1, 0.03)])
    body, c = b.shape, b.center
    # big scales, each with a pink rim, as on many reef parrotfish
    rims, plates = [], []
    for i in range(9):
        x = 26 - i * 8
        hh = (b.top(x) - b.bot(x)) / 2
        zc = (b.top(x) + b.bot(x)) / 2
        for j in range(-2, 3):
            z = zc + j * hh * 0.33 + (4 if i % 2 else 0) * (1 if j < 2 else 0) * 0.5
            if abs(z - zc) > hh * 0.8:
                continue
            for side in (-1, 1):
                y = side * b.hw(x, z)
                rims.append(ellipsoid((x, y, z), 4.3, 0.55, 3.5))
                plates.append(ellipsoid((x + 0.5, y + side * 0.22, z), 3.7, 0.5, 2.9))
    stripes = [stripe(body, 1.025, (44, -3), 22, 0.9, 30, 52, c), stripe(body, 1.025, (44, 3), 8, 0.8, 32, 52, c)]

    def top(x):
        return b.top(x)

    def bot(x):
        return b.bot(x)
    dorsal = [(30, top(30) - 3), (26, top(26) + 8), (12, top(12) + 10), (-6, top(-6) + 10), (-24, top(-24) + 9),
              (-36, top(-36) + 7), (-41, top(-41) - 2)]
    anal = [(-10, bot(-10) + 3), (-14, bot(-14) - 8), (-30, bot(-30) - 9), (-40, bot(-40) - 5), (-42, bot(-42) + 2)]
    caudal = [(-45, 7), (-55, 16), (-69, 27), (-62, 11), (-59, 0), (-62, -11), (-69, -27), (-55, -16), (-45, -7)]
    fins_edge, fins_in = [], []
    for outline, root in ((dorsal, (-5, top(-5) - 3)), (anal, (-26, bot(-26) + 2)), (caudal, (-46, 0))):
        e, i = edged_fin(outline, root, thick=1.5, margin=0.82)
        fins_edge.append(e)
        fins_in.append(i)
    rays = Part.makeCompound([fin_rays((-46, 0), caudal[1:-1], 2.0), fin_rays((-5, top(-5) - 3), dorsal[1:-1], 2.0)])
    pect = fin_plate([(0, 0), (-5, 6), (-16, 7), (-22, 2), (-18, -4), (-6, -3)], 1.2)
    pects = [placed(pect, [((1, 0, 0), side * -12), ((0, 0, 1), side * 28)], (22, side * (b.hw(22, -4) - 0.5), -4)) for side in (-1, 1)]
    beak_up = ellipsoid((50.5, 0, 0.8), 3.6, 5.2, 3.0)
    beak_lo = ellipsoid((50, 0, -3.4), 3.2, 4.6, 2.4)
    return [
        ('Body', body, teal),
        ('ScaleRims', Part.makeCompound(rims), '#f29bbd'),
        ('Scales', Part.makeCompound(plates), '#29c2ab'),
        ('FaceStripes', Part.makeCompound(stripes), '#ff9a6a'),
        ('FinEdges', Part.makeCompound(fins_edge), pink),
        ('Fins', Part.makeCompound(fins_in), '#2aa7c4'),
        ('FinRays', rays, '#1f8fae'),
        ('Pectorals', Part.makeCompound(pects), '#7fe0c9'),
        ('Beak', Part.makeCompound([beak_up, beak_lo]), beak),
    ] + fish_eyes(b, 33, 7, 4.4, iris='#f2b33a', rim='#ff8fb5')


def hermitcrab():
    # borrowed snail shell: shrinking whorls stacked along a tilted axis, with a spiral ridge
    whorls, z, R = [], 0.0, 11.0
    for k in range(4):
        whorls.append(Part.makeTorus(R, R * 0.9, V(0, 0, z)))
        z += R * 0.95
        R *= 0.66
    shell = whorls[0]
    for w in whorls[1:]:
        shell = shell.fuse(w)
    shell = shell.fuse(Part.makeCone(R * 1.6, 0.3, R * 3, V(0, 0, z - R), V(0, 0, 1)))
    ridge_pts, zz, RR = [], 0.0, 11.0
    for k in range(48):
        u = k / 47
        a = u * 3.6 * TAU
        RR = 11 * 0.66 ** (u * 3.6) * 1.9
        zz = 11 * 0.95 * (1 - 0.66 ** (u * 3.6)) / (1 - 0.66) - 0.5
        ridge_pts.append((RR * math.cos(a), RR * math.sin(a), zz))
    ridge = tube(ridge_pts, [0.9, 0.4], n=90)
    aperture = Part.makeTorus(7.2, 1.4, V(9, 0, -5), V(0.6, 0, -0.8))
    for part in (shell, ridge, aperture):
        part.rotate(V(0, 0, 0), V(0, 1, 0), -62)
        part.translate(V(-8, 0, 8))

    red, pale = '#d9482b', '#f3e3d2'
    joints = []
    legs = []
    for side in (-1, 1):
        for i in range(3):
            x = 7 + i * 5.5
            legs.append(jointed_leg([(x, side * 6, -1), (x + 3, side * 13, 3), (x + 7, side * 18, -4), (x + 10, side * 19, -12)],
                                    [1.8, 1.5, 1.2, 0.3], joints))
    body = Body(22, top=[(0, 0.15), (0.3, 0.32), (0.7, 0.3), (1, 0.15)], bot=[(0, -0.1), (0.5, -0.2), (1, -0.1)],
                wid=[(0, 0.15), (0.4, 0.4), (1, 0.3)]).shape
    body.translate(V(12, 0, 1))
    # big right claw: a heavy palm with a fixed finger and a movable finger, opened slightly
    palm = ellipsoid((26, -8, 1), 7.5, 4.5, 5.2, rot=[((0, 0, 1), -18)])
    fixed = tube([(32, -10, -1), (37, -11, -2.5), (40, -11, -1.5)], [2.2, 1.4, 0.4])
    moving = tube([(32, -10, 3), (37, -11.5, 4.5), (40.5, -11.5, 2.5)], [2.0, 1.3, 0.4])
    arm_big = jointed_leg([(16, -5, 1), (20, -9, 2), (23, -8, 1)], [2.6, 2.6, 2.6], joints)
    small = ellipsoid((24, 7, 1.5), 5, 2.8, 3.2, rot=[((0, 0, 1), 18)])
    small_f = tube([(28, 8.5, 1.5), (32, 9.5, 1.0)], [1.2, 0.3])
    arm_small = jointed_leg([(16, 5, 1), (19, 7, 2), (21, 7, 1.5)], [1.6, 1.6, 1.6], joints)
    stalks, eyes_, antennae = [], [], []
    for side in (-1, 1):
        stalks.append(tube([(19, side * 2.5, 5), (21, side * 3.5, 10), (22, side * 4.5, 14)], [1.0, 0.9, 0.9]))
        eyes_.append(ellipsoid((22.3, side * 4.6, 15.2), 1.5, 1.5, 2.0))
        antennae.append(tube([(21, side * 1.5, 4), (30, side * 4, 11), (40, side * 9, 13), (48, side * 15, 9)], [0.5, 0.35, 0.25, 0.15]))
    return [
        ('Shell', shell, '#c9a46b'),
        ('ShellRidge', ridge, '#a3804b'),
        ('Aperture', aperture, '#e9d2a6'),
        ('Body', body, '#e06a45'),
        ('Claws', Part.makeCompound([palm, fixed, moving, arm_big, small, small_f, arm_small]), red),
        ('Legs', Part.makeCompound(legs), red),
        ('Joints', Part.makeCompound(joints), pale),
        ('Stalks', Part.makeCompound(stalks), '#e06a45'),
        ('Eyes', Part.makeCompound(eyes_), '#151515'),
        ('Antennae', Part.makeCompound(antennae), '#e9875f'),
    ]


def turtle():
    shell = Body(80,
                 top=[(0, 0.04), (0.08, 0.1), (0.25, 0.155), (0.5, 0.165), (0.75, 0.12), (0.92, 0.06), (1, 0.03)],
                 bot=[(0, -0.01), (0.1, -0.03), (0.5, -0.04), (0.9, -0.025), (1, -0.01)],
                 wid=[(0, 0.1), (0.1, 0.22), (0.35, 0.29), (0.6, 0.27), (0.85, 0.17), (1, 0.05)], square=0.25)
    cara = shell.shape

    def surf(x, y):
        """A point on the shell's upper surface."""
        top, bot, w = shell.top(x), shell.bot(x), shell.hw(x)
        zc, rz = (top + bot) / 2, (top - bot) / 2
        f = max(0.0, 1 - (abs(y) / w) ** 2.4) if w > 0 else 0
        return V(x, y, zc + rz * f ** (1 / 2.4) + 0.25)

    def seam(pts):
        return tube([tuple(surf(x, y)) for x, y in pts], [0.42], n=max(8, len(pts) * 4))
    seams = []
    for x in (26, 12, -2, -16, -29):
        seams.append(seam([(x, -9), (x + 1, 0), (x, 9)]))
    for side in (-1, 1):
        seams.append(seam([(32, side * 8), (19, side * 9.5), (5, side * 9.5), (-9, side * 9.5), (-23, side * 8.5), (-33, side * 6)]))
        for xv, xe in ((19, 22), (5, 4), (-9, -14), (-23, -30)):
            ye = shell.hw(xe) * 0.86
            seams.append(seam([(xv, side * 9.5), ((xv + xe) / 2, side * (9.5 + ye) / 2), (xe, side * ye)]))
        ring = [(x, side * shell.hw(x) * 0.86) for x in (38, 30, 18, 4, -10, -24, -34, -38)]
        seams.append(seam(ring))
    flecks = []
    rng = random.Random(3)
    for _ in range(22):
        x, y = rng.uniform(-32, 32), rng.uniform(-1, 1)
        y *= shell.hw(x) * 0.75
        p = surf(x, y)
        flecks.append(ellipsoid((p.x, p.y, p.z - 0.45), rng.uniform(3, 5.5), rng.uniform(1.6, 3), 0.35, rot=[((0, 0, 1), rng.uniform(0, 180))]))
    plastron = ellipsoid((0, 0, -2.5), 33, 24, 4)

    hb = Body(26, top=[(0, 0.08), (0.15, 0.22), (0.45, 0.3), (0.8, 0.25), (1, 0.22)],
              bot=[(0, -0.08), (0.15, -0.16), (0.45, -0.2), (0.8, -0.2), (1, -0.2)],
              wid=[(0, 0.08), (0.2, 0.2), (0.5, 0.24), (1, 0.2)])
    head = hb.shape
    head.translate(V(48, 0, 2))
    scales = []
    for x, y, rx, ry in ((54, 0, 3.0, 2.4), (50, -3.4, 2.5, 1.9), (50, 3.4, 2.5, 1.9), (46, 0, 2.8, 2.4), (45.5, -4.6, 2.2, 1.7), (45.5, 4.6, 2.2, 1.7)):
        lx = x - 48
        zt, zb, w = hb.top(lx), hb.bot(lx), hb.hw(lx)
        zc, rz = (zt + zb) / 2, (zt - zb) / 2
        z = zc + rz * math.sqrt(max(0.0, 1 - (y / w) ** 2)) + 2 - 0.35
        scales.append(ellipsoid((x, y, z), rx, ry, 0.55))
    beak = ellipsoid((60.2, 0, 1.0), 2.4, 3.2, 3.0)

    flipper = fin_plate([(-6, -4), (6, 5), (6, 14), (-2, 26), (-12, 36), (-17, 37), (-12, 24), (-8, 10), (-12, -2)], 3.0, plane='xy', edge=0.65)
    edge_scales = Part.makeCompound([ellipsoid((x, y, 1.1), 2.2, 1.5, 0.7, rot=[((0, 0, 1), 40)]) for x, y in ((4.5, 8), (3, 14), (-1, 20), (-5, 25), (-9.5, 30))])
    flipper = placed(flipper, [((1, 0, 0), -14)], (22, 17, -1))
    edge_scales = placed(edge_scales, [((1, 0, 0), -14)], (22, 17, -1))
    rear = fin_plate([(4, -4), (0, 6), (-6, 11), (-14, 10), (-10, 1), (-4, -4)], 2.4, plane='xy', edge=0.65)
    rear = placed(rear, [((1, 0, 0), -8)], (-27, 10, -1))
    skin = '#7d9a5b'
    return [
        ('Carapace', cara, '#6b5130'),
        ('Flecks', Part.makeCompound(flecks), '#80633a'),
        ('Seams', Part.makeCompound(seams), '#3a2a17'),
        ('Plastron', plastron, '#e1d09a'),
        ('Head', head, skin),
        ('HeadScales', Part.makeCompound(scales), '#a9b86e'),
        ('Beak', beak, '#5b5a3c'),
        ('Flippers', mirrored_pair(flipper.fuse(rear)), skin),
        ('FlipperScales', mirrored_pair(edge_scales), '#a9b86e'),
        ('Eyes', Part.makeCompound([sphere((55, side * 4.6, 4), 1.9) for side in (-1, 1)]), '#1e140c'),
        ('Glints', Part.makeCompound([sphere((55.8, side * 6.3, 4.8), 0.4) for side in (-1, 1)]), '#ffffff'),
    ]


def moonjelly():
    # bell: a thin dome whose rim is scalloped into 16 small lobes
    def bell_ring(z, r, scallop):
        pts = []
        for j in range(96):
            a = TAU * j / 96
            rr = r * (1 + scallop * (0.5 + 0.5 * math.cos(16 * a)))
            pts.append(V(rr * math.cos(a), rr * math.sin(a), z - scallop * 30 * (0.5 - 0.5 * math.cos(16 * a))))
        return closed_curve(pts)
    rings = []
    for z, r, sc in ((17.5, 3, 0), (16, 12, 0), (12.5, 21, 0), (7, 27, 0), (2.5, 30, 0.02), (0, 31, 0.035)):
        rings.append(bell_ring(z, r, sc))
    outer = Part.makeLoft(rings, True, False)
    bell = outer.fuse(ellipsoid((0, 0, 17.2), 4.2, 4.2, 1.1))  # see-through on the website, so the gonads stay visible
    # four horseshoe-shaped gonads seen through the bell
    gonads = []
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        c = V(9.5 * math.cos(a), 9.5 * math.sin(a), 12)
        inward = V(-math.cos(a), -math.sin(a), 0)
        horseshoe = Part.makeTorus(5.2, 1.5, c, V(0, 0, 1)).cut(Part.makeCylinder(3.6, 8, c + inward * 5.6 - V(0, 0, 4)))
        gonads.append(horseshoe)
    margin = Part.makeTorus(30.5, 0.9, V(0, 0, -0.2))
    tentacles = []
    for i in range(72):
        a = TAU * i / 72
        L = 12 + 6 * math.sin(i * 1.7)
        pts = [((30.5 - 2 * u) * math.cos(a) + math.sin(i + u * 4) * 1.5 * u, (30.5 - 2 * u) * math.sin(a), -0.5 - L * u) for u in (0, 0.33, 0.66, 1)]
        tentacles.append(tube(pts, [0.42, 0.3, 0.2], n=6))
    oral = []
    for i in range(4):
        a = i * math.pi / 2
        pts = []
        for k in range(9):
            u = k / 8
            r = 3 + 7 * u
            pts.append((r * math.cos(a) + math.sin(u * 9 + i) * 2.5 * u, r * math.sin(a) + math.cos(u * 9 + i) * 2.5 * u, 2 - 36 * u))
        oral.append(ribbon(pts, [2.4, 4.2, 3.6, 1.2], 0.55, twist=2.5 + i * 0.3, n=12))
    return [
        ('Bell', bell, '#cfe3ff'),
        ('Gonads', Part.makeCompound(gonads), '#c77ddb'),
        ('Margin', margin, '#e8f2ff'),
        ('Tentacles', Part.makeCompound(tentacles), '#eaf2ff'),
        ('OralArms', Part.makeCompound(oral), '#f5c6e4'),
    ]


def dolphin():
    b = Body(100,
             top=[(0, 0.012), (0.04, 0.02), (0.08, 0.03), (0.1, 0.06), (0.14, 0.095), (0.2, 0.115), (0.32, 0.13), (0.45, 0.125),
                  (0.6, 0.1), (0.72, 0.075), (0.84, 0.045), (0.93, 0.03), (1, 0.02)],
             bot=[(0, -0.012), (0.04, -0.022), (0.08, -0.035), (0.14, -0.07), (0.22, -0.1), (0.35, -0.12), (0.5, -0.11),
                  (0.65, -0.08), (0.78, -0.05), (0.9, -0.025), (1, -0.018)],
             wid=[(0, 0.012), (0.06, 0.025), (0.14, 0.075), (0.25, 0.11), (0.4, 0.12), (0.6, 0.09), (0.78, 0.045), (0.9, 0.016), (1, 0.01)])
    body, c = b.shape, b.center

    def top(x):
        return b.top(x)
    dorsal = fin_plate([(12, top(12) - 2), (6, top(6) + 8), (-2, top(-2) + 16), (-9, top(-9) + 19), (-7, top(-7) + 12),
                        (-12, top(-12) + 3), (-16, top(-16) - 2)], 2.6, edge=0.6)
    flukes = fin_plate([(-44, 2), (-50, 10), (-58, 21), (-63, 21), (-60, 9), (-57, 0), (-60, -9), (-63, -21), (-58, -21),
                        (-50, -10), (-44, -2)], 2.4, plane='xy', edge=0.6)
    flukes.translate(V(0, 0, (b.top(-50) + b.bot(-50)) / 2))
    flipper = fin_plate([(0, 0), (-5, 4), (-14, 4), (-21, 1), (-12, -3), (-3, -3)], 2.2, edge=0.6)
    flippers = [placed(flipper, [((1, 0, 0), side * -55), ((0, 0, 1), side * 22)], (27, side * (b.hw(27, -7) - 1), -7)) for side in (-1, 1)]
    smile = [placed(tube([(49.5, 0, -0.4), (44, 0, -1.6), (38, 0, -1.4)], [0.35, 0.4, 0.3]), [], (0, 0, 0))]
    smile = Part.makeCompound([s2.mirror(V(0, 0, 0), V(0, 1, 0)) if side < 0 else s2 for side in (-1, 1) for s2 in
                               [tube([(49.5, side * 1.1, -0.5), (44, side * 2.6, -1.7), (37.5, side * 4.4, -1.2)], [0.35, 0.4, 0.3])]])
    blowhole = ellipsoid((30, 0, top(30) + 0.1), 0.9, 2.6, 0.6)
    patches = [ellipsoid((35.5, side * (b.hw(35.5, 1) - 0.2), 1), 3.2, 0.8, 2.0) for side in (-1, 1)]
    return [
        ('Body', body, '#8b9bac'),
        ('Cape', above(body, 1.012, 3.5, c), '#5d6d7e'),
        ('Belly', below(body, 1.015, -6, c), '#ebe6e6'),
        ('Dorsal', dorsal, '#5d6d7e'),
        ('Flukes', flukes, '#66778a'),
        ('Flippers', Part.makeCompound(flippers), '#6c7d8f'),
        ('Smile', smile, '#3d4652'),
        ('Blowhole', blowhole, '#2d343c'),
        ('EyePatches', Part.makeCompound(patches), '#59697a'),
    ] + fish_eyes(b, 35.5, 1, 1.5, iris='#2a1d14')


def lanternfish():
    b = Body(100,
             top=[(0, 0.03), (0.04, 0.085), (0.12, 0.13), (0.25, 0.15), (0.45, 0.145), (0.65, 0.11), (0.82, 0.065), (0.93, 0.045), (1, 0.04)],
             bot=[(0, -0.045), (0.04, -0.085), (0.12, -0.115), (0.25, -0.125), (0.45, -0.12), (0.65, -0.085), (0.82, -0.05), (0.93, -0.035), (1, -0.03)],
             wid=[(0, 0.03), (0.1, 0.07), (0.3, 0.08), (0.6, 0.06), (0.9, 0.03), (1, 0.02)])
    body, c = b.shape, b.center
    # photophores: glowing lights in rows along the lower flank, each in a dark cup
    cups, lights = [], []
    for row, (x0, x1, dz) in enumerate(((36, -42, 2.5), (14, -36, 7.5))):
        n = 12 if row == 0 else 7
        for k in range(n):
            x = x0 + (x1 - x0) * k / (n - 1)
            z = b.bot(x) + dz
            for side in (-1, 1):
                y = side * b.hw(x, z)
                d = V(0, side, -0.3)
                cups.append(Part.makeTorus(1.5, 0.45, V(x, y, z), d))
                lights.append(Part.makeSphere(1.25, V(x, y + side * 0.2, z)))
    lights.append(Part.makeSphere(2.0, V(44, 0, 6)))  # the bright spot on the snout
    jaw = tube([(49, 0, -3), (40, 0, -6), (28, 0, -7)], [0.6, 0.6, 0.5])
    jaws = [placed(jaw, [], (0, side * 3.5, 0)) for side in (-1, 1)]

    def top(x):
        return b.top(x)

    def bot(x):
        return b.bot(x)
    fins = [
        fin_plate([(6, top(6) - 2), (2, top(2) + 9), (-8, top(-8) + 8), (-14, top(-14) - 1)], 1.0),
        fin_plate([(-24, top(-24) - 1), (-27, top(-27) + 4), (-31, top(-31) - 1)], 1.6),  # adipose fin
        fin_plate([(-12, bot(-12) + 2), (-16, bot(-16) - 7), (-30, bot(-30) - 6), (-34, bot(-34) + 1)], 1.0),
        fin_plate([(-46, 4), (-56, 12), (-66, 17), (-58, 4), (-57, 0), (-58, -4), (-66, -17), (-56, -12), (-46, -4)], 1.2),
    ]
    pect = fin_plate([(0, 0), (-4, 3), (-17, 3), (-20, 0), (-6, -2)], 0.8)
    fins += [placed(pect, [((1, 0, 0), side * -12), ((0, 0, 1), side * 25)], (26, side * (b.hw(26, -5) - 0.4), -5)) for side in (-1, 1)]
    return [
        ('Body', body, '#90a5ba'),
        ('Back', above(body, 1.04, 2, c), '#2b3a4c'),
        ('Belly', below(body, 1.02, b.bot(0) + 5, c), '#c9d5e0'),
        ('Fins', Part.makeCompound(fins), '#55687a'),
        ('Jaws', Part.makeCompound(jaws), '#1d2833'),
        ('LightCups', Part.makeCompound(cups), '#1a2430'),
        ('Lights', Part.makeCompound(lights), '#8ff4ff'),
    ] + fish_eyes(b, 36, 3, 7.0, iris='#1b2a38', rim='#b9c6d2')


def hatchetfish():
    b = Body(100,
             top=[(0, 0.04), (0.06, 0.14), (0.16, 0.25), (0.28, 0.3), (0.42, 0.27), (0.56, 0.19), (0.7, 0.1), (0.84, 0.06), (0.93, 0.05), (1, 0.05)],
             bot=[(0, -0.02), (0.06, -0.12), (0.16, -0.32), (0.3, -0.46), (0.44, -0.47), (0.56, -0.38), (0.66, -0.2), (0.78, -0.08), (0.9, -0.045), (1, -0.04)],
             wid=[(0, 0.035), (0.12, 0.065), (0.35, 0.07), (0.6, 0.05), (0.8, 0.03), (1, 0.018)], keel=0.9)
    body, c = b.shape, b.center
    lights, cups = [], []
    for k in range(10):
        x = 30 - k * 5.5
        z = b.bot(x) + 1.8
        for side in (-1, 1):
            y = side * max(b.hw(x, z) * 0.35, 1.0)
            cups.append(Part.makeTorus(1.3, 0.4, V(x, y, z), V(0, side * 0.4, -1)))
            lights.append(Part.makeSphere(1.1, V(x, y, z - 0.3)))
    spines = [Part.makeCone(1.0, 0.05, 4, V(x, 0, b.bot(x) + 1), V(-0.5, 0, -1)) for x in (-6, -11, -16)]
    # big tube-shaped eyes that point straight up to spot prey silhouetted above
    tubes, irises, glints = [], [], []
    for side in (-1, 1):
        base = V(30, side * (b.hw(30, 14) - 1), 13)
        d = V(0, side * 0.25, 1)
        d.normalize()
        tubes.append(Part.makeCylinder(6.2, 10, base, d))
        tubes.append(Part.makeTorus(6.2, 1.1, base + d * 10, d))
        irises.append(Part.makeSphere(5.6, base + d * 9.6))
        glints.append(Part.makeSphere(1.1, base + d * 14.6 + V(1.8, 0, 0)))

    def top(x):
        return b.top(x)
    fins = [
        fin_plate([(-6, top(-6) - 2), (-9, top(-9) + 8), (-17, top(-17) + 5), (-19, top(-19) - 1)], 1.0),
        fin_plate([(-45, 3), (-55, 13), (-62, 15), (-56, 3), (-55, 0), (-56, -3), (-62, -15), (-55, -13), (-45, -3)], 1.0),
        fin_plate([(-28, b.bot(-28) + 2), (-31, b.bot(-31) - 6), (-40, b.bot(-40) - 4), (-42, b.bot(-42) + 1)], 0.8),
    ]
    pect = fin_plate([(0, 0), (-4, 4), (-15, 2), (-14, -2)], 0.7)
    fins += [placed(pect, [((1, 0, 0), side * -15), ((0, 0, 1), side * 25)], (24, side * (b.hw(24, -2) - 0.4), -2)) for side in (-1, 1)]
    return [
        ('Body', body, '#d4dee8'),
        ('Back', above(body, 1.02, b.top(20) - 9, c), '#3d4c5e'),
        ('Fins', Part.makeCompound(fins), '#a9bccc'),
        ('Spines', Part.makeCompound(spines), '#b8c6d4'),
        ('LightCups', Part.makeCompound(cups), '#2a3442'),
        ('Lights', Part.makeCompound(lights), '#bff8ff'),
        ('EyeTubes', Part.makeCompound(tubes), '#c3cfdb'),
        ('Irises', Part.makeCompound(irises), '#101a24'),
        ('Glints', Part.makeCompound(glints), '#ffffff'),
        ('Mouth', tube([(49, 0, -1), (46, 0, -6), (41, 0, -9)], [0.7, 0.6, 0.5]), '#2a3442'),
    ]


def swordfish():
    b = Body(100,
             top=[(0, 0.03), (0.05, 0.07), (0.15, 0.105), (0.3, 0.12), (0.5, 0.115), (0.7, 0.08), (0.85, 0.045), (0.95, 0.025), (1, 0.022)],
             bot=[(0, -0.03), (0.05, -0.06), (0.15, -0.09), (0.3, -0.1), (0.5, -0.095), (0.7, -0.065), (0.85, -0.035), (0.95, -0.022), (1, -0.02)],
             wid=[(0, 0.03), (0.15, 0.08), (0.35, 0.09), (0.6, 0.07), (0.85, 0.03), (1, 0.02)])
    body, c = b.shape, b.center
    # the flat, wide "sword"
    sword = Part.makeLoft([body_section(x, 0.3 + h, -0.3 - h * 0.6, w) for x, w, h in
                           ((46, 3.6, 1.6), (58, 2.8, 1.0), (74, 1.8, 0.6), (88, 0.8, 0.3), (94, 0.25, 0.1))], True, False)

    def top(x):
        return b.top(x)

    def bot(x):
        return b.bot(x)
    dark = '#2e3150'
    fins = [
        fin_plate([(31, top(31) - 2), (28, top(28) + 12), (24, top(24) + 24), (18, top(18) + 32), (16, top(16) + 27),
                   (17, top(17) + 16), (14, top(14) + 6), (8, top(8) - 1)], 1.6),
        fin_plate([(-34, top(-34) - 1), (-37, top(-37) + 5), (-41, top(-41) - 1)], 1.0),
        fin_plate([(-46, 2), (-54, 18), (-63, 34), (-58, 14), (-56, 0), (-58, -14), (-63, -34), (-54, -18), (-46, -2)], 1.6),
        fin_plate([(-30, bot(-30) + 1), (-33, bot(-33) - 6), (-38, bot(-38) + 1)], 1.0),
    ]
    pect = fin_plate([(0, 0), (-6, 3), (-24, 0), (-34, -6), (-20, -4), (-6, -3)], 1.2)
    fins += [placed(pect, [((1, 0, 0), side * -20), ((0, 0, 1), side * 18)], (28, side * (b.hw(28, -6) - 0.4), -6)) for side in (-1, 1)]
    keels = [ellipsoid((-44, side * b.hw(-44), 0), 4.5, 1.2, 1.4) for side in (-1, 1)]
    return [
        ('Body', body, '#7b88a0'),
        ('Back', above(body, 1.02, 3, c), '#3b3d60'),
        ('Belly', below(body, 1.02, -5, c), '#d5dde5'),
        ('Sword', sword, '#3d4058'),
        ('Fins', Part.makeCompound(fins), dark),
        ('Keels', Part.makeCompound(keels), dark),
    ] + fish_eyes(b, 40, 2.5, 4.6, iris='#1b2340', rim='#5b6584')


def giantsquid():
    red = '#b23a2e'
    mantle = Body(120, top=[(0, 0.004), (0.06, 0.028), (0.25, 0.058), (0.5, 0.075), (0.75, 0.078), (0.92, 0.07), (1, 0.066)],
                  bot=[(0, -0.004), (0.06, -0.028), (0.25, -0.058), (0.5, -0.075), (0.75, -0.078), (0.92, -0.07), (1, -0.066)],
                  wid=[(0, 0.004), (0.06, 0.028), (0.25, 0.058), (0.5, 0.075), (0.75, 0.078), (0.92, 0.07), (1, 0.066)])
    m = mantle.shape
    m.translate(V(62, 0, 0))
    fins = fin_plate([(84, 0), (100, 14), (112, 16), (122, 2), (122, -2), (112, -16), (100, -14)], 1.6, plane='xy', edge=0.6)
    head = ellipsoid((-6, 0, 0), 12, 9.5, 9).fuse(ellipsoid((-4, -6.5, 0.5), 6.5, 4, 6.5)).fuse(ellipsoid((-4, 6.5, 0.5), 6.5, 4, 6.5))
    rng = random.Random(11)
    spots = []
    for _ in range(50):
        x = rng.uniform(8, 100)
        a = rng.uniform(0, TAU)
        r = mantle.hw(x - 62) - 0.25
        spots.append(ellipsoid((x, r * math.cos(a), r * math.sin(a)), 1.4, 1.1, 1.1))
    arms, rims, cups = [], [], []
    for i in range(8):
        theta = TAU * i / 8 + 0.2
        b, r, c, _ = cephalopod_arm(theta, 62, 0.35, 0.18 if i % 2 else -0.18, -1.42, r0=3.6, n=16, base_r=5, base_z=0)
        arms.append(b)
        rims += r
        cups += c
    # two long feeding tentacles, each ending in a sucker-covered club
    tents, clubs, club_suckers = [], [], []
    for side in (-1, 1):
        pts = [(side * 2.5, 0, 0), (side * 3.5, math.sin(side) * 3, -30), (side * 6, 4 * side, -60), (side * 4, -2, -88)]
        tents.append(tube(pts, [1.4, 1.1, 1.0], n=24))
        club = ellipsoid((0, 0, 0), 2.6, 2.2, 10)
        club.translate(V(side * 4.5, -2.5, -97))
        clubs.append(club)
        for k in range(8):
            z = -90 - k * 2
            club_suckers.append(Part.makeTorus(0.9, 0.3, V(side * 4.5 - side * 2.4, -2.5, z), V(-side, 0, 0)))
    group = [Part.makeCompound(x) for x in (arms, rims, cups, tents, clubs, club_suckers)]
    group = [as_along_x(g) for g in group]
    for g in group:
        g.translate(V(-14, 0, 0))
    arms_s, rims_s, cups_s, tents_s, clubs_s, cs_s = group
    return [
        ('Mantle', m.fuse(head), red),
        ('Spots', Part.makeCompound(spots), '#8f2a20'),
        ('Fins', fins, '#a33328'),
        ('Arms', Part.makeCompound([arms_s, tents_s, clubs_s]), '#a8362b'),
        ('SuckerRims', Part.makeCompound([rims_s, cs_s]), '#f2c9b4'),
        ('SuckerCups', cups_s, '#d98a76'),
        ('EyeRims', Part.makeCompound([Part.makeTorus(5.6, 0.9, V(-4, side * 10.2, 0.8), V(0, side, 0)) for side in (-1, 1)]), '#d9d4cf'),
        ('Eyes', Part.makeCompound([sphere((-4, side * 9.4, 0.8), 5.2) for side in (-1, 1)]), '#10161e'),
        ('Glints', Part.makeCompound([sphere((-2.2, side * 14.1, 2.8), 0.9) for side in (-1, 1)]), '#ffffff'),
    ]


def spermwhale():
    b = Body(100,
             top=[(0, 0.06), (0.01, 0.11), (0.04, 0.135), (0.15, 0.145), (0.3, 0.145), (0.4, 0.13), (0.5, 0.115), (0.58, 0.11),
                  (0.66, 0.1), (0.76, 0.075), (0.86, 0.045), (0.94, 0.025), (1, 0.02)],
             bot=[(0, -0.035), (0.02, -0.075), (0.08, -0.1), (0.25, -0.125), (0.42, -0.13), (0.58, -0.1), (0.72, -0.065),
                  (0.86, -0.035), (0.95, -0.02), (1, -0.018)],
             wid=[(0, 0.05), (0.03, 0.09), (0.15, 0.105), (0.35, 0.115), (0.55, 0.095), (0.75, 0.055), (0.9, 0.025), (1, 0.014)],
             square=0.35)
    body, c = b.shape, b.center
    jaw = tube([(45, 0, -9.5), (34, 0, -11.8), (22, 0, -12.6), (12, 0, -12)], [1.9, 2.3, 2.6, 2.8], n=10)
    teeth = []
    for k in range(9):
        x = 41 - k * 3.2
        z = -11.8 + (k / 8) * -0.6 + 1.6
        for side in (-1, 1):
            teeth.append(Part.makeCone(0.75, 0.1, 2.0, V(x, side * 1.3, z), V(0, side * 0.2, 1)))
    blowhole = ellipsoid((48.2, -3.2, b.top(48) - 0.4), 1.6, 0.8, 0.6, rot=[((0, 0, 1), 30)])
    wrinkles = Part.makeCompound([band(body, 1.004, x, 0.4, (x % 7) - 3, c) for x in range(4, -40, -5)])
    knuckles = [ellipsoid((x, 0, b.top(x) - 0.6), 3.5, 2.4, 1.6) for x in (-14, -22, -28, -33, -38)]
    knuckles[0] = ellipsoid((-12, 0, b.top(-12) - 0.5), 6, 3.2, 3)
    flukes = fin_plate([(-46, 2), (-52, 12), (-60, 26), (-66, 27), (-63, 10), (-58, 0), (-63, -10), (-66, -27), (-60, -26),
                        (-52, -12), (-46, -2)], 2.6, plane='xy', edge=0.6)
    flukes.translate(V(0, 0, (b.top(-50) + b.bot(-50)) / 2))
    flip = fin_plate([(0, 0), (-4, 3), (-11, 3), (-14, 0), (-8, -3)], 2.0, edge=0.6)
    flips = [placed(flip, [((1, 0, 0), side * -55), ((0, 0, 1), side * 20)], (13, side * (b.hw(13, -9) - 1), -9)) for side in (-1, 1)]
    mouth_light = [ellipsoid((40, side * (b.hw(40, -8) - 0.3), -8), 6, 0.8, 1.6) for side in (-1, 1)]
    return [
        ('Body', body, '#4a4540'),
        ('Wrinkles', wrinkles, '#524c46'),
        ('Knuckles', Part.makeCompound(knuckles), '#4f4943'),
        ('LipPatches', Part.makeCompound(mouth_light), '#bdb7ae'),
        ('Jaw', jaw, '#d6d3cd'),
        ('Teeth', Part.makeCompound(teeth), '#fbf8ef'),
        ('Blowhole', blowhole, '#1f1c19'),
        ('Flukes', flukes, '#3f3a35'),
        ('Flippers', Part.makeCompound(flips), '#3f3a35'),
    ] + fish_eyes(b, 16, -6.5, 1.3, iris='#15120f')


def vampiresquid():
    body_c = '#5a1424'
    mantle = Body(40, top=[(0, 0.02), (0.1, 0.18), (0.4, 0.3), (0.7, 0.28), (1, 0.22)],
                  bot=[(0, -0.02), (0.1, -0.18), (0.4, -0.3), (0.7, -0.28), (1, -0.22)],
                  wid=[(0, 0.02), (0.1, 0.18), (0.4, 0.3), (0.7, 0.28), (1, 0.22)]).shape
    mantle.translate(V(20, 0, 0))
    fins = []
    for side in (-1, 1):
        f = fin_plate([(0, 0), (4, 6), (0, 11), (-6, 9), (-6, 2)], 1.4)
        fins.append(placed(f, [((1, 0, 0), side * 80), ((0, 0, 1), side * -10)], (30, side * 10.5, 1)))
    arms, cirri, tips, paths = [], [], [], []
    for i in range(8):
        theta = TAU * i / 8
        b, _, _, pts = cephalopod_arm(theta, 34, 0.55, 0.0, -0.9, r0=3.2, n=12, base_r=5, base_z=0, suckers=False)
        arms.append(b)
        paths.append(pts)
        tips.append(Part.makeSphere(1.6, pts[-1]))
        for k in range(2, 11, 2):
            p0, p1 = pts[k], pts[k + 1]
            d = V(0, 0, 0) - V(p0.x, p0.y, 0)
            d.normalize()
            cirri.append(Part.makeCone(0.6, 0.1, 2.2, p0, d + V(0, 0, -0.4)))
    def scallop(z, rmin, rmax, n=64):
        pts = []
        for j in range(n):
            a = TAU * j / n
            lobe = 0.5 + 0.5 * math.cos(8 * a)
            r = rmin + (rmax - rmin) * lobe
            pts.append(V(r * math.cos(a), r * math.sin(a), z - 4 * lobe))
        return closed_curve(pts)
    web = Part.makeLoft([Part.Wire(Part.makeCircle(6, V(0, 0, 1), V(0, 0, 1))), scallop(-8, 11, 16), scallop(-18, 15, 25)], True, False)
    group = [as_along_x(Part.makeCompound(x)) for x in (arms, cirri, tips, [web])]
    arms_s, cirri_s, tips_s, web_s = group
    head = ellipsoid((-1, 0, 0), 8, 8.5, 8)
    lights = [Part.makeSphere(1.3, V(32, side * 6.5, 3)) for side in (-1, 1)]
    return [
        ('Mantle', mantle.fuse(head), body_c),
        ('Fins', Part.makeCompound(fins), '#6e1d30'),
        ('Web', web_s, '#2a0912'),
        ('Arms', arms_s, '#3a0d19'),
        ('Cirri', cirri_s, '#7a2a3a'),
        ('Lights', Part.makeCompound([tips_s] + lights), '#6fb4ff'),
        ('Eyes', Part.makeCompound([sphere((0, side * 7.4, 1.5), 4.4) for side in (-1, 1)]), '#2f86c9'),
        ('Pupils', Part.makeCompound([sphere((0.4, side * 10.6, 1.5), 2.3) for side in (-1, 1)]), '#0a1a2a'),
        ('Glints', Part.makeCompound([sphere((1.6, side * 11.4, 3.2), 0.7) for side in (-1, 1)]), '#ffffff'),
    ]


def anglerfish():
    b = Body(80, top=[(0, 0.1), (0.05, 0.22), (0.18, 0.33), (0.35, 0.37), (0.55, 0.33), (0.75, 0.2), (0.9, 0.09), (1, 0.06)],
             bot=[(0, -0.08), (0.06, -0.24), (0.2, -0.36), (0.4, -0.38), (0.6, -0.3), (0.78, -0.16), (0.9, -0.07), (1, -0.05)],
             wid=[(0, 0.1), (0.12, 0.26), (0.35, 0.32), (0.6, 0.27), (0.85, 0.11), (1, 0.05)])
    body = b.shape
    mouth = fin_plate([(46, 14), (12, 2), (20, -12), (44, -24)], 70)
    inside = scaled(body, 0.9, b.center).common(mouth)
    body = body.cut(mouth)
    lips = Part.makeCompound([tube([(41, side * (b.hw(41, 12) - 1), 12), (28, side * (b.hw(28, 8) - 1), 8), (16, side * (b.hw(16, 3) - 1), 3)], [1.0], n=12)
                              for side in (-1, 1)])
    rng = random.Random(4)
    teeth = []
    # needle teeth lining both jaws, longest at the front, pointing into the mouth
    for pts, up in (([(44, 14), (34, 10.5), (24, 6.5), (14, 2.5)], -1), ([(43, -23), (35, -19), (27, -15), (20, -12)], 1)):
        for k in range(10):
            u = k / 9
            x, z = lerp_list([p[0] for p in pts], u), lerp_list([p[1] for p in pts], u)
            length = (8.5 - 5 * u) * rng.uniform(0.75, 1.15)
            for side in (-1, 1):
                y = side * (b.hw(x, z) - 1.6)
                teeth.append(Part.makeCone(0.8, 0.05, length, V(x, y, z), V(-0.25, -side * 0.25, up)))
    rod = tube([(10, 0, 27), (18, 0, 46), (32, 0, 52), (42, 0, 44), (46, 0, 36)], [1.3, 1.0, 0.8, 0.7, 0.6], n=20)
    esca = ellipsoid((46.5, 0, 33), 3.6, 3.6, 4.4)
    filaments = [tube([(46.5, 0, 29), (46.5 + 3 * math.cos(a), 3 * math.sin(a), 25), (46.5 + 5 * math.cos(a), 5 * math.sin(a), 21)], [0.35, 0.2, 0.12])
                 for a in (0, 1.6, 3.2, 4.8)]
    bumps = []
    for _ in range(80):
        x = rng.uniform(-30, 18)
        zc = (b.top(x) + b.bot(x)) / 2
        hh = (b.top(x) - b.bot(x)) / 2
        z = zc + rng.uniform(-0.85, 0.85) * hh
        for side in (-1, 1):
            if rng.random() < 0.5:
                bumps.append(Part.makeSphere(rng.uniform(0.5, 1.1), V(x, side * b.hw(x, z), z)))
    lateral = [Part.makeSphere(0.55, V(x, side * (b.hw(x, 2) + 0.2), 2 + math.sin(x / 9) * 2)) for x in range(-28, 22, 4) for side in (-1, 1)]

    def top(x):
        return b.top(x)
    fins = [
        fin_plate([(-38, 4), (-50, 14), (-56, 6), (-56, -6), (-50, -14), (-38, -4)], 1.4),
        fin_plate([(-24, top(-24) - 2), (-28, top(-28) + 6), (-34, top(-34) + 3), (-35, top(-35) - 2)], 1.2),
        fin_plate([(-24, b.bot(-24) + 2), (-28, b.bot(-28) - 6), (-34, b.bot(-34) - 3), (-35, b.bot(-35) + 2)], 1.2),
    ]
    pect = fin_plate([(0, 0), (-4, 5), (-11, 4), (-12, -1), (-6, -3)], 1.0)
    fins += [placed(pect, [((0, 0, 1), side * 25)], (-6, side * (b.hw(-6, -6) - 0.5), -6)) for side in (-1, 1)]
    return [
        ('Body', body, '#2a2026'),
        ('Mouth', inside, '#0f0a0d'),
        ('Lips', lips, '#3a2c34'),
        ('Teeth', Part.makeCompound(teeth), '#efece2'),
        ('Bumps', Part.makeCompound(bumps), '#3a2e35'),
        ('LateralLine', Part.makeCompound(lateral), '#a99aa2'),
        ('Fins', Part.makeCompound(fins), '#3a2d34'),
        ('Rod', rod, '#4a3a44'),
        ('Lure', esca, '#c8fff0'),
        ('Filaments', Part.makeCompound(filaments), '#9fe8d4'),
    ] + fish_eyes(b, 22, 16, 2.6, iris='#38443a', rim='#3a2c34')


def gulpereel():
    dark = '#211c27'
    pts = [(-2 - 110 * u, math.sin(u * 7) * 7 * u, math.sin(u * 4.5 + 1) * 5 * u) for u in [k / 12 for k in range(13)]]
    tail = tube(pts, [3.8, 3.2, 2.6, 2.0, 1.5, 1.1, 0.8, 0.6, 0.45, 0.35, 0.28, 0.24, 0.2], n=60)
    fin = []
    for c, t, nrm, bnm, u in curve_frames(pts, 40)[2:-4]:
        r = lerp_list([3.8, 3.2, 2.6, 2.0, 1.5, 1.1, 0.8, 0.6, 0.45, 0.35, 0.28, 0.24, 0.2], u)
        fin.append(Part.makeCylinder(0.25, r * 0.9 + 0.6, c, V(0, 0, 1)))
    head = ellipsoid((4, 0, 3), 6, 4.2, 4.4)
    pouch_secs = [body_section(x, top, bot, w) for x, top, bot, w in
                  ((4, 3, -2, 3.5), (12, 5, -10, 6.5), (24, 7, -16, 9), (36, 9.5, -16, 9), (46, 12, -9, 6.5), (50, 13, -3, 3))]
    pouch = Part.makeLoft(pouch_secs, True, False)
    opening = ellipsoid((49, 0, 4.5), 2.5, 4.5, 8)
    upper = tube([(5, 0, 6), (20, 0, 9.5), (36, 0, 11.5), (51, 0, 13.5)], [0.9, 0.8, 0.7, 0.5])
    lowers = [tube([(5, side * 1, 0), (20, side * 7, -10), (36, side * 8.5, -12), (50, side * 2.5, -3)], [0.7, 0.8, 0.7, 0.5]) for side in (-1, 1)]
    tip = pts[-1]
    light = Part.makeSphere(2.0, V(*tip))
    tassels = [tube([tip, (tip[0] - 3, tip[1] + 2 * math.cos(a), tip[2] + 2 * math.sin(a)), (tip[0] - 6, tip[1] + 3 * math.cos(a), tip[2] + 3 * math.sin(a))], [0.3, 0.2, 0.1])
               for a in (0, 2.1, 4.2)]
    return [
        ('Body', head.fuse(pouch), dark),
        ('Mouth', opening, '#060407'),
        ('Jaws', Part.makeCompound([upper] + lowers), '#4a4155'),
        ('Tail', tail, dark),
        ('TailFin', Part.makeCompound(fin), '#2e2736'),
        ('Light', light, '#ff7fb2'),
        ('Tassels', Part.makeCompound(tassels), '#ff9cc4'),
        ('Eyes', Part.makeCompound([sphere((7, side * 3.6, 5.5), 1.2) for side in (-1, 1)]), '#0a0a0a'),
        ('Glints', Part.makeCompound([sphere((7.4, side * 4.6, 6), 0.3) for side in (-1, 1)]), '#ffffff'),
    ]


def dumbo():
    pink = '#f2a8b8'
    bell = ellipsoid((0, 0, 19), 23.5, 22.5, 22).fuse(ellipsoid((0, 0, 8), 19, 19, 9))
    ear = fin_plate([(0, -3), (8, -6), (16, -3), (18, 3), (13, 8), (4, 6)], 2.2, edge=0.55)
    ear.rotate(V(0, 0, 0), V(1, 0, 0), 90)
    ear.rotate(V(0, 0, 0), V(0, 1, 0), -25)
    ear.translate(V(19, 0, 28))
    ears = [ear, ear.mirror(V(0, 0, 0), V(1, 0, 0))]
    arms, cirri, tips = [], [], []
    for i in range(8):
        theta = TAU * i / 8 + TAU / 16
        b, _, _, pts = cephalopod_arm(theta, 26, 1.1, 0.0, -1.0, r0=3.6, n=12, base_r=9, base_z=4, suckers=False)
        arms.append(b)
        tips.append(Part.makeSphere(1.0, pts[-1]))
        for k in range(1, 10, 2):
            c = pts[k]
            d = V(c.x, c.y, 0)
            d.normalize()
            cirri.append(Part.makeCone(0.45, 0.08, 1.8, c + V(0, 0, -1.2), V(0, 0, -1) - d * 0.3))
    def scallop(z, rmin, rmax, n=64):
        pts = []
        for j in range(n):
            a = TAU * j / n
            lobe = 0.5 + 0.5 * math.cos(8 * (a - TAU / 16))
            r = rmin + (rmax - rmin) * lobe
            pts.append(V(r * math.cos(a), r * math.sin(a), z - 3 * lobe))
        return closed_curve(pts)
    web = Part.makeLoft([Part.Wire(Part.makeCircle(17, V(0, 0, 8), V(0, 0, 1))), scallop(0, 18, 23), scallop(-6, 18, 27)], True, False)
    return [
        ('Bell', bell, pink),
        ('Ears', Part.makeCompound(ears), '#eb98ab'),
        ('Web', web, '#e690a4'),
        ('Arms', Part.makeCompound(arms), '#e48aa0'),
        ('Cirri', Part.makeCompound(cirri), '#f7c2cd'),
        ('EyeRims', Part.makeCompound([Part.makeTorus(4.2, 1.1, V(side * 9, -19.6, 14), V(0, -1, 0)) for side in (-1, 1)]), '#e690a4'),
        ('Eyes', Part.makeCompound([sphere((side * 9, -19.2, 14), 3.8) for side in (-1, 1)]), '#1a0f14'),
        ('Glints', Part.makeCompound([sphere((side * 9 - 1.2, -22.6, 15.6), 0.8) for side in (-1, 1)]), '#ffffff'),
    ]


def isopod():
    lav = '#c4b6cc'
    shell_b = Body(80, top=[(0, 0.08), (0.08, 0.16), (0.3, 0.2), (0.6, 0.19), (0.85, 0.14), (1, 0.06)],
                   bot=[(0, -0.02), (0.1, -0.04), (0.5, -0.05), (0.9, -0.04), (1, -0.02)],
                   wid=[(0, 0.12), (0.1, 0.26), (0.4, 0.3), (0.7, 0.28), (0.9, 0.22), (1, 0.12)], square=0.4)
    dome = shell_b.shape
    c = shell_b.center
    plates = [band(dome, 1.03, x, 2.8, 0, c) for x in range(26, -34, -7)]
    lappets = []
    for x in range(26, -34, -7):
        for side in (-1, 1):
            lappets.append(ellipsoid((x - 1.5, side * (shell_b.hw(x) + 1.0), 0), 3.4, 2.2, 1.0, rot=[((0, 0, 1), side * -25)]))
    head = Body(16, top=[(0, 0.2), (0.4, 0.42), (1, 0.45)], bot=[(0, -0.1), (1, -0.2)], wid=[(0, 0.3), (0.4, 0.75), (1, 0.8)]).shape
    head.translate(V(44, 0, 1))
    eyes_, facets = [], []
    for side in (-1, 1):
        eyes_.append(ellipsoid((45, side * 10, 3.5), 3.6, 1.8, 2.4, rot=[((0, 0, 1), side * -30)]))
        for k in range(10):
            a = TAU * k / 10
            facets.append(Part.makeSphere(0.35, V(45 + 2.4 * math.cos(a), side * (11.6 - abs(math.cos(a))), 3.5 + 1.6 * math.sin(a))))
    joints, legs = [], []
    for side in (-1, 1):
        for i in range(7):
            x = 24 - i * 8
            hw = shell_b.hw(x)
            legs.append(jointed_leg([(x, side * hw * 0.7, -1), (x + 1, side * (hw + 4), -4), (x + 3, side * (hw + 6), -9), (x + 5, side * (hw + 6.5), -13)],
                                    [1.5, 1.3, 1.0, 0.25], joints))
    antennae = []
    for side in (-1, 1):
        antennae.append(tube([(50, side * 3, 2), (60, side * 9, 5), (72, side * 18, 4), (84, side * 28, -1)], [1.0, 0.7, 0.5, 0.25], n=24))
        antennae.append(tube([(51, side * 2, 3), (56, side * 4, 6), (60, side * 6, 6)], [0.6, 0.4, 0.2]))
    telson = fin_plate([(0, 10), (-6, 9), (-11, 4), (-12, 0), (-11, -4), (-6, -9), (0, -10)], 2.2, plane='xy', edge=0.6)
    telson.translate(V(-38, 0, 1.5))
    spikes = [Part.makeCone(0.6, 0.05, 2.4, V(-38 - 12 * math.cos(a), 10 * math.sin(a), 1.5), V(-math.cos(a), math.sin(a) * 0.6, 0))
              for a in [k * 0.25 - 1.0 for k in range(9)]]
    uropods = [placed(fin_plate([(0, 0), (-4, 3), (-12, 2), (-14, 0), (-10, -2)], 1.2, plane='xy'), [((0, 0, 1), side * 18)], (-38, side * 9, 0.5)) for side in (-1, 1)]
    return [
        ('Shell', dome.fuse(head), '#9d8ea8'),
        ('Plates', Part.makeCompound(plates), lav),
        ('Lappets', Part.makeCompound(lappets), '#b5a6be'),
        ('Tail', Part.makeCompound([telson] + uropods), '#b5a6be'),
        ('Spikes', Part.makeCompound(spikes), '#ddd2e2'),
        ('Legs', Part.makeCompound(legs), '#8f7fa0'),
        ('Joints', Part.makeCompound(joints), '#a796b5'),
        ('Antennae', Part.makeCompound(antennae), '#8f7fa0'),
        ('Eyes', Part.makeCompound(eyes_), '#1f1a24'),
        ('Facets', Part.makeCompound(facets), '#3c3346'),
    ]


MODELS = {
    'octopus': octopus,
    'clownfish': clownfish, 'seahorse': seahorse, 'seastar': seastar, 'parrotfish': parrotfish,
    'hermitcrab': hermitcrab, 'turtle': turtle, 'moonjelly': moonjelly, 'dolphin': dolphin,
    'lanternfish': lanternfish, 'hatchetfish': hatchetfish, 'swordfish': swordfish, 'giantsquid': giantsquid,
    'spermwhale': spermwhale, 'vampiresquid': vampiresquid, 'anglerfish': anglerfish, 'gulpereel': gulpereel,
    'dumbo': dumbo, 'isopod': isopod,
}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def build(mid):
    import ImportGui
    name = 'WL_' + mid
    if name in App.listDocuments():
        App.closeDocument(name)
    doc = App.newDocument(name)
    objs = []
    for part, shape, color in MODELS[mid]():
        o = doc.addObject('Part::Feature', part)
        o.Shape = shape
        if App.GuiUp:
            small = any(k in part for k in SMALL_PARTS)
            o.ViewObject.ShapeColor = hex_rgb(color)
            o.ViewObject.Deviation = DEVIATION * (3 if small else 1)
            o.ViewObject.AngularDeflection = 65 if small else ANGULAR
        objs.append(o)
    doc.recompute()
    path = os.path.join(OUT, mid + '.glb')
    ImportGui.export(objs, path)
    return path, os.path.getsize(path)


for mid in (MODELS if ONLY is None else ONLY):
    try:
        p, size = build(mid)
        print(f'{mid}: {size // 1024} KB')
    except Exception as e:  # keep going so one bad model doesn't block the rest
        print(f'{mid}: FAILED {e!r}')
