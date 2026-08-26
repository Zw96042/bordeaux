        radius = wine_bowl_radius(z)
        for segment in range(WINE_FILL_SEGMENTS):
            angle = segment / WINE_FILL_SEGMENTS * math.tau
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), z))
    for ring in range(WINE_FILL_RINGS - 1):
        for segment in range(WINE_FILL_SEGMENTS):
            following = (segment + 1) % WINE_FILL_SEGMENTS
            current = ring * WINE_FILL_SEGMENTS + segment
            next_ring = (ring + 1) * WINE_FILL_SEGMENTS + segment
            faces.append((current, ring * WINE_FILL_SEGMENTS + following, (ring + 1) * WINE_FILL_SEGMENTS + following, next_ring))

    bottom_center = len(vertices)
    vertices.append((0.0, 0.0, WINE_BOTTOM_Z))
    for segment in range(WINE_FILL_SEGMENTS):
        faces.append((bottom_center, (segment + 1) % WINE_FILL_SEGMENTS, segment))

    top_center = len(vertices)
    vertices.append((0.0, 0.0, WINE_REST_Z))
    top_offset = (WINE_FILL_RINGS - 1) * WINE_FILL_SEGMENTS
    top_face_start = len(faces)
    for segment in range(WINE_FILL_SEGMENTS):
        faces.append((top_center, top_offset + segment, top_offset + (segment + 1) % WINE_FILL_SEGMENTS))

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(wine_material)
    mesh.materials.append(meniscus_material)
    mesh.update()
    for polygon in mesh.polygons:
        if polygon.index >= top_face_start:
            polygon.material_index = 1
            polygon.use_smooth = False
        else:
            polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    add_bevel(obj, 0.010, 2)
    return obj


def set_wine_fill_surface(
    rig: "GlassRig",
    surface_z: float,
    *,
    pouring: bool = False,
    retention: float = 1.0,
) -> None:
    retained_scale = clamp01(retention)
    if retained_scale <= 0.01:
        set_visible(rig.wine, False)
        set_visible(rig.meniscus, False)
        return
    matrix = rig.root.matrix_world
    rest_plane_z = (matrix @ Vector((0.0, 0.0, surface_z))).z
    if pouring:
        lip_z = rig.pour_origin.matrix_world.translation.z
        plane_z = min(rest_plane_z, lip_z + 0.008)
    else:
        plane_z = rest_plane_z
    if retained_scale < 0.999:
        floor_z = WINE_BOTTOM_Z + 0.004
        floor_radius = wine_bowl_radius(floor_z)
        retainable_plane_z = max(
            (
                matrix
                @ Vector(
                    (
                        floor_radius * math.cos(segment / WINE_FILL_SEGMENTS * math.tau),
                        floor_radius * math.sin(segment / WINE_FILL_SEGMENTS * math.tau),
                        floor_z,
                    )
                )
            ).z
            for segment in range(WINE_FILL_SEGMENTS)
        )
        plane_z = max(plane_z, retainable_plane_z + 0.0005)

    top_heights: list[float] = []
    for segment in range(WINE_FILL_SEGMENTS):
        angle = segment / WINE_FILL_SEGMENTS * math.tau
        cosine = math.cos(angle)
        sine = math.sin(angle)

        def world_height(local_z: float) -> float:
            radius = wine_bowl_radius(local_z)
            return (matrix @ Vector((radius * cosine, radius * sine, local_z))).z

        low = WINE_BOTTOM_Z
        high = WINE_MAX_Z
        if world_height(low) >= plane_z:
            top_height = low
        elif world_height(high) <= plane_z:
            top_height = high
        else:
            for _ in range(18):
                middle = (low + high) * 0.5
                if world_height(middle) < plane_z:
                    low = middle
                else:
                    high = middle
            top_height = (low + high) * 0.5
        top_heights.append(top_height)

    mesh = rig.wine.data
    for ring in range(WINE_FILL_RINGS):
        ring_progress = ring / (WINE_FILL_RINGS - 1)
        for segment, top_height in enumerate(top_heights):
            z = mix(WINE_BOTTOM_Z, top_height, ring_progress)
            angle = segment / WINE_FILL_SEGMENTS * math.tau
            radius = wine_bowl_radius(z)
            mesh.vertices[ring * WINE_FILL_SEGMENTS + segment].co = (
                radius * math.cos(angle),
                radius * math.sin(angle),
                z,
            )

    top_center_index = WINE_FILL_RINGS * WINE_FILL_SEGMENTS + 1
    matrix_z = matrix[2][2]
    center_z = (plane_z - matrix.translation.z) / matrix_z if abs(matrix_z) > 0.0001 else WINE_BOTTOM_Z
    mesh.vertices[top_center_index].co = (0.0, 0.0, center_z)
    mesh.update()
    pivot_segment = max(range(WINE_FILL_SEGMENTS), key=top_heights.__getitem__)
    pivot_angle = pivot_segment / WINE_FILL_SEGMENTS * math.tau
    pivot_radius = wine_bowl_radius(WINE_BOTTOM_Z)
    pivot = Vector(
        (
            pivot_radius * math.cos(pivot_angle),
            pivot_radius * math.sin(pivot_angle),
            WINE_BOTTOM_Z,
        )
    )
    rig.wine.scale = (retained_scale, retained_scale, retained_scale)
    rig.wine.location = pivot * (1.0 - retained_scale)
    set_visible(rig.wine, surface_z > WINE_BOTTOM_Z + 0.012 and retained_scale > 0.01)
    set_visible(rig.meniscus, False)


def add_cylinder(name: str, radius: float, depth: float, location, material, bevel: float) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    shade_smooth(obj)
    add_bevel(obj, bevel, 4)
    return obj


def add_torus(name: str, major_radius: float, minor_radius: float, location, material) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=160,
        minor_segments=20,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    shade_smooth(obj)
    return obj


def parent_keep_transform(child: bpy.types.Object, parent: bpy.types.Object) -> None:
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


@dataclass
class GlassRig:
    root: bpy.types.Object
    liquid_root: bpy.types.Object
    shell: bpy.types.Object
    rim: bpy.types.Object
    stem: bpy.types.Object
    foot: bpy.types.Object
    foot_rim: bpy.types.Object
    wine: bpy.types.Object
    meniscus: bpy.types.Object
    pour_origin: bpy.types.Object
    parts: tuple[bpy.types.Object, ...]


def create_glass(name: str, glass_material, wine_material, meniscus_material) -> GlassRig:
    root = bpy.data.objects.new(f"{name}Root", None)
    bpy.context.collection.objects.link(root)
    liquid_root = bpy.data.objects.new(f"{name}LiquidRoot", None)
    bpy.context.collection.objects.link(liquid_root)
    liquid_root.parent = root

    shell_profile = (
        (0.12, 1.23),
        (0.18, 1.28),
        (0.31, 1.39),
        (0.50, 1.58),
        (0.72, 1.86),
        (0.91, 2.19),
        (1.04, 2.56),
        (1.09, 2.91),
        (1.06, 3.34),
    )
    shell = create_revolved_surface(f"{name}Bowl", shell_profile, glass_material)
    solidify = shell.modifiers.new("Real glass wall", "SOLIDIFY")
    solidify.thickness = 0.035
    solidify.offset = 0.0
    add_bevel(shell, 0.012, 3)

    rim = add_torus(f"{name}Rim", 1.06, 0.026, (0, 0, 3.34), glass_material)
    stem = add_cylinder(f"{name}Stem", 0.052, 1.18, (0, 0, 0.65), glass_material, 0.025)
    foot = add_cylinder(f"{name}Foot", 0.72, 0.045, (0, 0, 0.035), glass_material, 0.035)
    foot_rim = add_torus(f"{name}FootRim", 0.69, 0.018, (0, 0, 0.055), glass_material)

    wine = create_wine_fill(f"{name}Wine", wine_material, meniscus_material)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=48, location=(0, 0, 2.39), scale=(0.89, 0.89, 0.035))
    meniscus = bpy.context.object
    meniscus.name = f"{name}Meniscus"
    meniscus.data.materials.append(meniscus_material)
    shade_smooth(meniscus)
    set_visible(meniscus, False)

    pour_origin = bpy.data.objects.new(f"{name}PourOrigin", None)
    bpy.context.collection.objects.link(pour_origin)
    pour_origin.location = (1.02, 0.0, 3.28)

    for part in (shell, rim, stem, foot, foot_rim, pour_origin):
        parent_keep_transform(part, root)
    for part in (wine, meniscus):
        parent_keep_transform(part, liquid_root)

    return GlassRig(
        root=root,
        liquid_root=liquid_root,
        shell=shell,
        rim=rim,
        stem=stem,
        foot=foot,
        foot_rim=foot_rim,
        wine=wine,
        meniscus=meniscus,
        pour_origin=pour_origin,
        parts=(shell, rim, stem, foot, foot_rim, wine),
    )


def make_curve(name: str, material, bevel_depth: float, points: int = 160) -> bpy.types.Object:
    curve = bpy.data.curves.new(f"{name}Curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 12
    curve.bevel_depth = bevel_depth
    curve.bevel_resolution = 6
    curve.use_fill_caps = True
    curve.materials.append(material)
    spline = curve.splines.new("POLY")
    spline.points.add(points - 1)
    for point in spline.points:
        point.co = (0, 0, -100, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    return obj


def set_curve_points(
    obj: bpy.types.Object,
    points: Sequence[Vector],
    radii: Sequence[float] | None = None,
) -> None:
    spline = obj.data.splines[0]
    count = len(spline.points)
    for index in range(count):
        source_index = min(index, len(points) - 1)
        source = points[source_index] if points else Vector((0, 0, -100))
        point = spline.points[index]
        point.co = (*source, 1.0)
        point.radius = radii[min(index, len(radii) - 1)] if radii else 1.0


def make_liquid_sheet(name: str, material, points: int = 180) -> bpy.types.Object:
    vertices = [(0.0, 0.0, -100.0)] * (points * 2)
    faces = [
        (index * 2, index * 2 + 1, (index + 1) * 2 + 1, (index + 1) * 2)
        for index in range(points - 1)
    ]
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    solidify = obj.modifiers.new("Liquid depth", "SOLIDIFY")
    solidify.thickness = 0.018
    solidify.offset = 0.0
    bevel = obj.modifiers.new("Liquid edge", "BEVEL")
    bevel.width = 0.009
    bevel.segments = 3
    bevel.limit_method = "ANGLE"
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def set_liquid_sheet(
    obj: bpy.types.Object,
    points: Sequence[Vector],
    half_widths: Sequence[float],
    progress: float,
    start_progress: float = 0.0,
) -> None:
    mesh = obj.data
    if not points:
        return
    last_source = len(points) - 1
    head_position = clamp01(progress) * last_source
    head_floor = int(math.floor(head_position))
    head_ceil = min(last_source, head_floor + 1)
    head_mix = head_position - head_floor
    head = points[head_floor].lerp(points[head_ceil], head_mix)
    head_width = mix(half_widths[head_floor], half_widths[head_ceil], head_mix)
    tail_position = min(head_position, clamp01(start_progress) * last_source)
    tail_floor = int(math.floor(tail_position))
    tail_ceil = min(last_source, tail_floor + 1)
    tail_mix = tail_position - tail_floor
    tail = points[tail_floor].lerp(points[tail_ceil], tail_mix)
    tail_width = mix(half_widths[tail_floor], half_widths[tail_ceil], tail_mix)

    for index in range(len(mesh.vertices) // 2):
        if index < tail_floor:
            position = tail
            half_width = 0.0
            source_index = tail_floor
        elif index == tail_floor:
            position = tail
            half_width = tail_width
            source_index = tail_floor
        elif index <= head_floor and index <= last_source:
            position = points[index]
            half_width = half_widths[min(index, len(half_widths) - 1)]
            source_index = index
        elif index == head_floor + 1 and index <= last_source:
            position = head
            half_width = head_width
            source_index = head_floor
        else:
            position = head
            half_width = 0.0
            source_index = head_floor

        previous = points[max(0, source_index - 1)]
        following = points[min(last_source, source_index + 1)]
        tangent = (following - previous).normalized()
        screen_normal = Vector((0.0, -1.0, 0.0)).cross(tangent)
        floor_normal = Vector((-tangent.y, tangent.x, 0.0))
        if screen_normal.length < 0.0001:
            screen_normal = Vector((1.0, 0.0, 0.0))
        if floor_normal.length < 0.0001:
            floor_normal = Vector((0.0, 1.0, 0.0))
        screen_normal.normalize()
        floor_normal.normalize()
        groundness = clamp01((0.27 - position.z) / 0.18)
        normal = screen_normal.lerp(floor_normal, groundness).normalized()
        mesh.vertices[index * 2].co = position - normal * half_width
        mesh.vertices[index * 2 + 1].co = position + normal * half_width
    mesh.update()


def look_at(obj: bpy.types.Object, target: Iterable[float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area_light(name: str, location, target, color, energy: float, size: float, shape="DISK") -> bpy.types.Object:
    data = bpy.data.lights.new(name, "AREA")
    data.color = color
    data.energy = energy
    data.shape = shape
    data.size = size
    if shape == "RECTANGLE":
        data.size_y = size * 0.45
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)
    return obj


def create_text(name: str, body: str, size: float, location, material, font_path: str | None = None) -> bpy.types.Object:
    curve = bpy.data.curves.new(f"{name}Curve", "FONT")
    curve.body = body
    curve.align_x = "LEFT"
    curve.align_y = "CENTER"
    curve.size = size
    curve.extrude = 0.008
    curve.bevel_depth = 0.003
    curve.bevel_resolution = 3
    if font_path and Path(font_path).exists():
        curve.font = bpy.data.fonts.load(font_path)
    curve.materials.append(material)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler.x = math.radians(90)
    return obj


@dataclass
class FilmScene:
    scene: bpy.types.Scene
    camera: bpy.types.Object
    focus: bpy.types.Object
    hero: GlassRig
    final: GlassRig
    route: bpy.types.Object
    route_glow: bpy.types.Object
    liquid_sheet: bpy.types.Object
    liquid_sheet_glow: bpy.types.Object
    title: bpy.types.Object
    tagline: bpy.types.Object
    wipe: bpy.types.Object
    floor: bpy.types.Object
    droplets: tuple[bpy.types.Object, ...]
    splash_rings: tuple[bpy.types.Object, ...]
    route_wine_material: bpy.types.Material
    route_glow_material: bpy.types.Material
    signal_material: bpy.types.Material
    signal_glow_material: bpy.types.Material


def configure_render(scene: bpy.types.Scene, args: argparse.Namespace) -> None:
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = args.samples if not args.preview else min(args.samples, 32)
    scene.eevee.use_raytracing = True
    scene.eevee.ray_tracing_method = "SCREEN"
    scene.eevee.use_fast_gi = True
    scene.eevee.fast_gi_quality = 1.0
    scene.eevee.fast_gi_ray_count = 8
    scene.eevee.fast_gi_step_count = 16
    scene.eevee.use_bokeh_jittered = True
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.render.fps = FPS
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.46
    scene.eevee.motion_blur_steps = 8
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = str(Path(args.output).resolve())

    world = bpy.data.worlds.new("Bordeaux World")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = NEAR_BLACK
    background.inputs["Strength"].default_value = 0.08
    scene.world = world


def build_scene(args: argparse.Namespace) -> FilmScene:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    configure_render(scene, args)

    glass_material = make_studio_glass_material()

    wine_material = make_material(
        "Bordeaux wine",
        (0.42, 0.008, 0.035, 1.0),
        roughness=0.14,
        transmission=0.0,
        ior=1.36,
        coat=0.32,
        emission=(0.16, 0.001, 0.010, 1.0),
        emission_strength=0.90,
    )
    meniscus_material = make_material(
        "Wine meniscus",
        WINE_HIGHLIGHT,
        roughness=0.08,
        transmission=0.06,
        ior=1.36,
        coat=0.45,
        emission=(0.30, 0.002, 0.018, 1.0),
        emission_strength=0.72,
    )
    route_material = make_material(
        "Wine ribbon",
        (0.48, 0.010, 0.055, 1.0),
        roughness=0.14,
        transmission=0.04,
        ior=1.36,
        coat=0.32,
        emission=(0.17, 0.001, 0.012, 1.0),
        emission_strength=0.16,
    )
    route_glow_material = make_material(
        "Wine ribbon glow",
        (0.20, 0.001, 0.010, 1.0),
        roughness=0.22,
        emission=(0.50, 0.004, 0.035, 1.0),
        emission_strength=1.0,
    )
    signal_material = make_material(
        "Trajectory signal",
        (0.18, 0.34, 0.86, 1.0),
        roughness=0.16,
        coat=0.24,
        emission=(0.06, 0.12, 0.44, 1.0),
        emission_strength=0.48,
    )
    signal_glow_material = make_material(
        "Trajectory signal glow",
        (0.08, 0.18, 0.58, 1.0),
        roughness=0.22,
        emission=(0.14, 0.30, 1.0, 1.0),
        emission_strength=1.0,
    )
    title_material = make_material(
        "Warm type",
        WARM_WHITE,
        roughness=0.24,
        emission=(0.22, 0.19, 0.16, 1.0),
        emission_strength=0.22,
    )
    title_material.surface_render_method = "DITHERED"
    tagline_material = title_material.copy()
    tagline_material.name = "Warm type detail"
    floor_material = make_material("Black mirror", (0.006, 0.005, 0.009, 1.0), roughness=0.22, coat=0.16)
    wall_material = make_material("Black cyclorama", (0.009, 0.005, 0.012, 1.0), roughness=0.48)
    wipe_material = make_material(
        "Wine wipe",
        (0.34, 0.012, 0.052, 1.0),
        roughness=0.92,
        emission=(0.34, 0.012, 0.052, 1.0),
        emission_strength=1.0,
    )

    hero = create_glass("Hero", glass_material, wine_material, meniscus_material)
    final = create_glass("Final", glass_material, wine_material, meniscus_material)

    bpy.ops.mesh.primitive_plane_add(size=28, location=(0, 0, 0))
    floor = bpy.context.object
    floor.name = "Reflective floor"
    floor.data.materials.append(floor_material)

    bpy.ops.mesh.primitive_plane_add(size=24, location=(0, 3.2, 5.0), rotation=(math.radians(90), 0, 0))
    wall = bpy.context.object
    wall.name = "Cyclorama wall"
    wall.data.materials.append(wall_material)

    route = make_curve("Wine route", route_material, 0.055, 180)
    route_glow = make_curve("Wine route glow", route_glow_material, 0.085, 180)
    liquid_sheet = make_liquid_sheet("Wine liquid sheet", route_material, 180)
    liquid_sheet_glow = make_liquid_sheet("Wine liquid sheet glow", route_glow_material, 180)
    liquid_sheet_glow.location.y = 0.024

    title = create_text(
        "Bordeaux wordmark",
        "bordeaux",
        0.72,
        (0.15, -0.12, 1.64),
        title_material,
        str(SPACE_GROTESK),
    )
    tagline = create_text(
        "Bordeaux tagline",
        "DRAW THE PATH   ·   KNOW THE RUN",
        0.105,
        (0.20, -0.10, 1.14),
        tagline_material,
        str(JETBRAINS_MONO),
    )
    tagline.data.space_character = 1.15

    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=1.0)
    wipe = bpy.context.object
    wipe.name = "Wine lens wipe"
    wipe.data.materials.append(wipe_material)

    droplets: list[bpy.types.Object] = []
    for index in range(12):
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=32,
            ring_count=16,
            radius=0.048 if index % 3 == 0 else 0.034,
        )
        droplet = bpy.context.object
        droplet.name = f"Wine droplet {index + 1:02d}"
        droplet.data.materials.append(route_material)
        shade_smooth(droplet)
        droplets.append(droplet)

    splash_rings: list[bpy.types.Object] = []
    for index, (major, minor) in enumerate(((0.42, 0.022), (0.48, 0.013))):
        ring = add_torus(f"Splash ring {index + 1}", major, minor, (0, 0, 0.06), route_glow_material)
        splash_rings.append(ring)

    camera_data = bpy.data.cameras.new("Cinema camera")
    camera = bpy.data.objects.new("Cinema camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0.45, -9.2, 2.85)
    camera_data.lens = 58
    camera_data.sensor_width = 36
    camera_data.dof.use_dof = True
    camera_data.dof.aperture_fstop = 3.2
    camera_data.dof.aperture_blades = 9
    camera_data.dof.aperture_ratio = 1.0
    focus = bpy.data.objects.new("Focus target", None)
    bpy.context.collection.objects.link(focus)
    focus.location = (-0.15, 0.0, 1.65)
    camera_data.dof.focus_object = focus
    look_at(camera, focus.location)
    scene.camera = camera

    add_area_light("Key softbox", (-4.4, -4.8, 6.6), (-0.5, 0, 1.7), (1.0, 0.86, 0.72), 1_250, 4.4, "RECTANGLE")
    add_area_light("Wine edge", (4.8, -1.8, 3.8), (0, 0, 1.8), (0.72, 0.025, 0.07), 1_000, 3.0, "RECTANGLE")
    add_area_light("Blue rim", (-3.8, 2.0, 4.8), (-0.3, 0, 2.0), (0.18, 0.34, 1.0), 850, 3.2, "RECTANGLE")
    add_area_light("Top line", (0.2, -0.2, 7.6), (0, 0, 1.2), (1.0, 0.92, 0.80), 900, 3.0, "DISK")

    return FilmScene(
        scene=scene,
        camera=camera,
        focus=focus,
        hero=hero,
        final=final,
        route=route,
        route_glow=route_glow,
        liquid_sheet=liquid_sheet,
        liquid_sheet_glow=liquid_sheet_glow,
        title=title,
        tagline=tagline,
        wipe=wipe,
        floor=floor,
        droplets=tuple(droplets),
        splash_rings=tuple(splash_rings),
        route_wine_material=route_material,
        route_glow_material=route_glow_material,
        signal_material=signal_material,
        signal_glow_material=signal_glow_material,
    )


def set_visible(obj: bpy.types.Object, visible: bool) -> None:
    obj.hide_render = not visible
    obj.hide_viewport = not visible


def set_curve_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    if len(obj.data.materials) == 0:
        obj.data.materials.append(material)
    elif obj.data.materials[0] != material:
        obj.data.materials[0] = material


def set_text_alpha(obj: bpy.types.Object, alpha: float) -> None:
    material = obj.data.materials[0]
    value = clamp01(alpha)
    set_principled_input(material, "Alpha", value)
    material.diffuse_color = (*material.diffuse_color[:3], value)


def set_rig_visible(rig: GlassRig, visible: bool) -> None:
    for part in rig.parts:
        set_visible(part, visible)


def reset_scene(film: FilmScene) -> None:
    set_rig_visible(film.hero, True)
    set_rig_visible(film.final, False)
    set_visible(film.route, False)
    set_visible(film.route_glow, False)
    set_visible(film.liquid_sheet, False)
    set_visible(film.liquid_sheet_glow, False)
    set_visible(film.title, False)
    set_visible(film.tagline, False)
    set_visible(film.wipe, False)
    for droplet in film.droplets:
        set_visible(droplet, False)
        droplet.scale = (1, 1, 1)
    for ring in film.splash_rings:
        set_visible(ring, False)
        ring.scale = (1, 1, 1)
    film.hero.root.location = (0, 0, 0)
    film.hero.root.rotation_euler = (0, 0, 0)
    film.hero.root.scale = (1, 1, 1)
    film.hero.liquid_root.location = (0, 0, 0)
    film.hero.liquid_root.rotation_euler = (0, 0, 0)
    film.hero.liquid_root.scale = (1, 1, 1)
    film.final.root.location = (0, 0, 0)
    film.final.root.rotation_euler = (0, 0, 0)
    film.final.root.scale = (1, 1, 1)
    for rig in (film.hero, film.final):
        rig.shell.scale = (1, 1, 1)
        rig.rim.scale = (1, 1, 1)
        rig.stem.scale = (1, 1, 1)
        rig.foot.scale = (1, 1, 1)
        rig.foot_rim.scale = (1, 1, 1)
        rig.wine.location = (0, 0, 0)
        rig.wine.rotation_euler = (0, 0, 0)
        rig.wine.scale = (1, 1, 1)
        set_visible(rig.meniscus, False)
        rig.meniscus.location = (0, 0, 2.39)
        rig.meniscus.rotation_euler = (0, 0, 0)
        rig.meniscus.scale = (1, 1, 1)
    film.route.data.bevel_factor_end = 1.0
    film.route_glow.data.bevel_factor_end = 1.0
    film.route.data.bevel_factor_start = 0.0
    film.route_glow.data.bevel_factor_start = 0.0


def update_final(film: FilmScene, time: float, start: float) -> None:
    set_rig_visible(film.hero, False)
    set_rig_visible(film.final, True)
    enter = phase(time, start, start + 0.42, ease_out)
    scale = mix(0.61, 0.68, enter)
    film.final.root.location = (-1.45, 0.10, mix(-0.03, 0.04, enter))
    film.final.root.rotation_euler = (0, 0, math.radians(-7.0))
    film.final.root.scale = (scale, scale, scale)
    film.camera.location = (0.18, -9.55, 2.55)
    film.focus.location = (-0.05, 0.0, 1.50)
    look_at(film.camera, film.focus.location)
    bpy.context.view_layer.update()
    set_wine_fill_surface(film.final, WINE_REST_Z)

    word = phase(time, start, start + 0.34, ease_out)
    set_visible(film.title, word > 0)
    set_text_alpha(film.title, word)
    title_scale = mix(0.97, 1.0, word)
    film.title.scale = (title_scale, title_scale, title_scale)
    film.title.location.z = mix(1.58, 1.64, word)
    tag = phase(time, start + 0.16, start + 0.46, ease_out)
    set_visible(film.tagline, tag > 0)
    set_text_alpha(film.tagline, tag)
    film.tagline.scale = (1.0, 1.0, 1.0)

    final_path = sample_cubic(
        Vector((-0.55, 0.05, 0.18)),
        Vector((0.10, 0.15, 0.18)),
        Vector((0.62, -0.22, 0.18)),
        Vector((1.36, 0.02, 0.18)),
        180,
    )
    signal_radii = [mix(0.58, 0.82, math.sin(index / 179 * math.pi)) for index in range(180)]
    set_curve_points(film.route, final_path, signal_radii)
    set_curve_points(film.route_glow, final_path, signal_radii)
    set_curve_material(film.route, film.signal_material)
    set_curve_material(film.route_glow, film.signal_glow_material)
    film.route.data.bevel_depth = 0.020
    film.route_glow.data.bevel_depth = 0.032
    film.route.data.bevel_factor_end = phase(time, start + 0.08, start + 0.50, ease_out)
    film.route_glow.data.bevel_factor_end = film.route.data.bevel_factor_end
    film.route.data.bevel_factor_start = 0.0
    film.route_glow.data.bevel_factor_start = 0.0
    set_visible(film.route, True)
    set_visible(film.route_glow, True)


def update_spill_route(film: FilmScene, time: float) -> None:
    if time >= 2.12:
        update_final(film, time, 2.18)
        wipe_out = 1.0 - phase(time, 2.18, 2.52, ease_out)
        set_visible(film.wipe, wipe_out > 0.01)
        film.wipe.location = (0.8, -4.7, 2.0)
        film.wipe.scale = (7.0 * wipe_out, 1.0 * wipe_out, 4.5 * wipe_out)
        return

    hero = film.hero
    appear = phase(time, 0.04, 0.34, ease_out)
    anticipation = phase(time, 0.30, 0.54, ease_out)
    fall = phase(time, 0.52, 1.24, ease_in_out)
    impact_time = 1.18
    elapsed = max(0.0, time - impact_time)
    recoil = math.exp(-6.3 * elapsed) * math.sin(elapsed * 16.0) if elapsed > 0 else 0.0
    # The bowl falls toward +X. The leading (+X) rim, airborne pour, impact,
    # and grounded route all share that direction; the small negative move is
    # the physical anticipation before the fall.
    angle = math.radians(-3.5 * anticipation + 64 * fall - 5.5 * recoil)
    scale = mix(0.87, 0.94, appear)
    hero.root.rotation_euler = (0, angle, math.radians(-6))
    hero.root.scale = (scale, scale, scale)
    foot_contact = Vector((0.72, 0.0, 0.0125)) * scale
    contact_offset = hero.root.rotation_euler.to_matrix() @ foot_contact
    contact_pivot = Vector((mix(-0.82, -0.55, fall), 0.0, 0.045))
    hero.root.location = contact_pivot - contact_offset

    drain = phase(time, 0.82, 1.54, ease_out)
    wine_z_scale = mix(1.0, 0.18, drain)
    wine_surface_z = WINE_BOTTOM_Z + (WINE_REST_Z - WINE_BOTTOM_Z) * wine_z_scale

    camera_drift = phase(time, 0.15, 1.62, ease_in_out)
    shake = math.exp(-11 * elapsed) * math.sin(elapsed * 92) if elapsed > 0 else 0.0
    film.camera.location = (
        mix(0.62, 0.48, camera_drift) + shake * 0.025,
        mix(-9.15, -8.72, camera_drift),
        2.83 + shake * 0.018,
    )
    film.focus.location = (mix(-0.28, 0.34, camera_drift), 0.0, 1.48)
    look_at(film.camera, film.focus.location)

    bpy.context.view_layer.update()
    pool_retention = 1.0 - phase(time, 1.18, 1.40, ease_in_out)
    set_wine_fill_surface(hero, wine_surface_z, pouring=time >= 0.76, retention=pool_retention)
    origin = hero.pour_origin.matrix_world.translation.copy()
    ground = Vector((2.58, 0.02, 0.10))
    air_path = sample_cubic(
        origin,
        origin + Vector((0.42, 0.02, -0.08)),
        ground + Vector((-0.32, 0.0, 0.60)),
        ground,
        58,
    )
    ground_path = sample_cubic(
        ground,
        Vector((3.04, -0.12, 0.075)),
        Vector((2.96, -0.88, 0.075)),
        Vector((2.12, -1.34, 0.075)),
        92,
    )
    ground_path += sample_cubic(
        Vector((2.12, -1.34, 0.075)),
        Vector((1.30, -1.82, 0.075)),
        Vector((0.42, -1.46, 0.075)),
        Vector((0.02, -0.68, 0.075)),
        89,
        True,
    )

    stream_progress = phase(time, 0.76, impact_time, gravity_ease)
    air_tail = phase(time, 1.34, 1.62, gravity_ease)
    stream_width = mix(1.0, 0.62, air_tail)
    air_radii: list[float] = []
    for index in range(len(air_path)):
        path_progress = index / (len(air_path) - 1)
        if air_tail <= 0.0001:
            tail_taper = 1.0
        else:
            tail_distance = clamp01((path_progress - air_tail) / 0.09)
            tail_taper = mix(0.10, 1.0, math.sin(tail_distance * math.pi * 0.5))
        air_radii.append(
            mix(0.054, 0.027, path_progress)
            * (1.0 + math.sin(path_progress * math.pi) * 0.16)
            * stream_width
            * tail_taper
        )
    set_liquid_sheet(
        film.liquid_sheet,
        air_path,
        air_radii,
        stream_progress,
        air_tail,
    )
    set_liquid_sheet(
        film.liquid_sheet_glow,
        air_path,
        [radius * 1.30 for radius in air_radii],
        stream_progress,
        air_tail,
    )
    stream_visible = stream_progress > 0.001 and air_tail < 0.995
    set_visible(film.liquid_sheet, stream_visible)
    set_visible(film.liquid_sheet_glow, stream_visible)

    ground_radii = [
        mix(1.36, 0.34, index / (len(ground_path) - 1))
        + math.sin(index / (len(ground_path) - 1) * math.pi * 4) * 0.055
        for index in range(len(ground_path))
    ]
    set_curve_points(film.route, ground_path, ground_radii)
    set_curve_points(film.route_glow, ground_path, ground_radii)
    set_curve_material(film.route, film.route_wine_material)
    set_curve_material(film.route_glow, film.route_glow_material)
    film.route.data.bevel_depth = 0.046
    film.route_glow.data.bevel_depth = 0.070
    route_progress = phase(time, impact_time, 1.74, ease_out)
    film.route.data.bevel_factor_end = route_progress
    film.route_glow.data.bevel_factor_end = route_progress
    film.route.data.bevel_factor_start = 0.0
    film.route_glow.data.bevel_factor_start = 0.0
    set_visible(film.route, route_progress > 0.001)
    set_visible(film.route_glow, route_progress > 0.001)

    ring_progress = phase(time, impact_time, impact_time + 0.46, ease_out)
    echo_progress = phase(time, impact_time + 0.09, impact_time + 0.72, ease_out)
    for ring, progress, size in (
        (film.splash_rings[0], ring_progress, 1.85),
        (film.splash_rings[1], echo_progress, 2.45),
    ):
        set_visible(ring, 0.001 < progress < 0.995)
        ring.location = ground
        ring.scale = (mix(0.24, size, progress), mix(0.24, size, progress), 1.0)

    velocities = (
        Vector((0.55, 0.12, 2.55)), Vector((1.15, -0.42, 2.05)),
        Vector((1.65, 0.38, 1.65)), Vector((0.18, -0.62, 2.82)),
        Vector((-0.42, 0.52, 2.20)), Vector((2.05, -0.16, 1.30)),
        Vector((0.82, 0.76, 3.00)), Vector((1.34, -0.82, 2.48)),
        Vector((-0.12, -0.30, 1.92)), Vector((1.92, 0.68, 1.82)),
        Vector((0.38, 0.92, 2.32)), Vector((1.48, 0.18, 2.72)),
    )
    for index, (droplet, velocity) in enumerate(zip(film.droplets, velocities)):
        if index == 0 and time < impact_time and stream_progress > 0.001:
            head_position = stream_progress * (len(air_path) - 1)
            head_floor = int(math.floor(head_position))
            head_ceil = min(len(air_path) - 1, head_floor + 1)
            set_visible(droplet, True)
            droplet.location = air_path[head_floor].lerp(
                air_path[head_ceil],
                head_position - head_floor,
            )
            droplet.scale = (1.20, 0.78, 1.08)
            continue
        local_time = time - impact_time - (index % 4) * 0.012
        visible = 0.0 <= local_time <= 0.92
        set_visible(droplet, visible)
        if visible:
            position = ground + velocity * local_time + Vector((0, 0, -4.9 * local_time * local_time))
            if position.z < 0.055:
                position.z = 0.055 + abs(position.z - 0.055) * 0.16
            droplet.location = position
            droplet.scale = (0.72, 0.72, 1.38)

    wipe_in = phase(time, 1.82, 2.16, ease_out)
    if wipe_in > 0:
        set_visible(film.wipe, True)
        film.wipe.location = (0.8, -4.7, 2.0)
        radius = mix(0.01, 7.0, wipe_in)
        film.wipe.scale = (radius, radius * 0.18, radius * 0.64)


def update_ribbon_flight(film: FilmScene, time: float) -> None:
    if time >= 1.98:
        update_final(film, time, 2.02)
        wipe_out = 1.0 - phase(time, 2.02, 2.32, ease_out)
        set_visible(film.wipe, wipe_out > 0.01)
        film.wipe.location = (0.6, -4.7, 2.0)
        film.wipe.scale = (7.0 * wipe_out, 1.0 * wipe_out, 4.5 * wipe_out)
        return
    hero = film.hero
    enter = phase(time, 0.04, 0.44, ease_out)
    tip = phase(time, 0.18, 0.78, drawer_ease)
    scale = mix(0.63, 0.74, enter)
    hero.root.location = (mix(-3.05, -2.22, enter), 0.30, 0.92 + math.sin(time * 2.4) * 0.028)
    hero.root.rotation_euler = (math.radians(-3), math.radians(mix(-4, 58, tip)), math.radians(5))
    hero.root.scale = (scale, scale, scale)
    drain = phase(time, 0.52, 1.48, ease_out)
    wine_z_scale = mix(1.0, 0.16, drain)
    wine_surface_z = WINE_BOTTOM_Z + (WINE_REST_Z - WINE_BOTTOM_Z) * wine_z_scale

    travel = phase(time, 0.12, 1.78, ease_in_out)
    film.camera.location = (mix(0.82, 0.10, travel), mix(-9.20, -8.45, travel), mix(2.88, 3.18, travel))
    film.focus.location = (mix(-0.45, 0.28, travel), -0.10, mix(1.58, 1.44, travel))
    look_at(film.camera, film.focus.location)
    bpy.context.view_layer.update()
    pool_retention = 1.0 - phase(time, 1.18, 1.54, ease_in_out)
    set_wine_fill_surface(hero, wine_surface_z, pouring=time >= 0.36, retention=pool_retention)
    origin = hero.pour_origin.matrix_world.translation.copy()
    path = sample_cubic(
        origin,
        origin + Vector((0.48, -0.08, -0.02)),
        origin + Vector((1.02, -0.58, -0.30)),
        origin + Vector((1.34, -1.10, -0.96)),
        68,
    )
    fall_point = path[-1]
    landing = Vector((2.35, 0.28, 0.18))
    path += sample_cubic(
        fall_point,
        fall_point + Vector((0.38, -0.30, -0.24)),
        landing + Vector((-0.30, -0.18, 0.42)),
        landing,
        66,
        True,
    )
    path += sample_cubic(
        landing,
        Vector((2.50, 0.82, 0.12)),
        Vector((3.02, 0.24, 0.14)),
        Vector((3.12, -0.62, 0.16)),
        48,
        True,
    )
    for index, point in enumerate(path):
        progress = index / (len(path) - 1)
        envelope = math.sin(progress * math.pi)
        point.y += math.sin(progress * math.pi * 5 - time * 3.2) * 0.045 * envelope
        point.z += math.sin(progress * math.pi * 3.5 - time * 2.0) * 0.022 * envelope
    ribbon_radii = [
        0.52
        + math.sin(index / (len(path) - 1) * math.pi) ** 0.72 * 0.78
        + math.sin(index / (len(path) - 1) * math.pi * 6) * 0.055
        for index in range(len(path))
    ]
    trace = phase(time, 0.36, 1.66, gravity_ease)
    # Once the reservoir has committed most of its volume, the emitted ribbon
    # becomes a finite advecting slug. Its tail pinches free, follows the head,
    # and thins under stretch instead of remaining tethered to the bowl.
    tail_progress = phase(time, 0.92, 1.90, gravity_ease)
    slug_stretch = mix(1.0, 0.70, tail_progress)
    source_shutoff = phase(time, 0.76, 0.98, ease_out)
    ribbon_widths: list[float] = []
    for index, radius in enumerate(ribbon_radii):
        progress = index / (len(path) - 1)
        if tail_progress <= 0.0001:
            tail_taper = mix(1.0, 0.16, source_shutoff) if index == 0 else 1.0
        else:
            tail_distance = clamp01((progress - tail_progress) / 0.050)
            tail_taper = mix(0.10, 1.0, math.sin(tail_distance * math.pi * 0.5))
        head_distance = clamp01((trace - progress) / 0.035)
        head_taper = mix(0.34, 1.0, math.sin(head_distance * math.pi * 0.5))
        ribbon_widths.append(radius * 0.060 * tail_taper * head_taper * slug_stretch)
    set_liquid_sheet(film.liquid_sheet, path, ribbon_widths, trace, tail_progress)
    set_liquid_sheet(
        film.liquid_sheet_glow,
        path,
        [radius * 1.34 for radius in ribbon_widths],
        trace,
        tail_progress,
    )
    sheet_visible = trace > 0.001 and tail_progress < 0.995
    set_visible(film.liquid_sheet, sheet_visible)
    set_visible(film.liquid_sheet_glow, sheet_visible)
    leader = film.droplets[0]
    set_visible(leader, 0.001 < trace < 0.999)
    if 0.001 < trace < 0.999:
        head_position = trace * (len(path) - 1)
        head_floor = int(math.floor(head_position))
        head_ceil = min(len(path) - 1, head_floor + 1)
        leader.location = path[head_floor].lerp(
            path[head_ceil],
            head_position - head_floor,
        )
        leader.scale = (1.72, 0.96, 1.42)
    for index, droplet in enumerate(film.droplets[1:4]):
        release_start = 0.98 + index * 0.055
        bead_progress = phase(time, release_start, 1.88 + index * 0.025, gravity_ease)
        bead_visible = release_start <= time < 1.94 and bead_progress < 0.985
        set_visible(droplet, bead_visible)
        if bead_visible:
            bead_position = bead_progress * (len(path) - 1)
            bead_floor = int(math.floor(bead_position))
            bead_ceil = min(len(path) - 1, bead_floor + 1)
            droplet.location = path[bead_floor].lerp(
                path[bead_ceil],
                bead_position - bead_floor,
            )
            bead_scale = (0.88, 0.70, 1.20) if index == 0 else (0.68, 0.62, 0.98)
            droplet.scale = bead_scale
    wipe_in = phase(time, 1.72, 2.02, ease_out)
    if wipe_in > 0:
        set_visible(film.wipe, True)
        film.wipe.location = (0.6, -4.7, 2.0)
        radius = mix(0.01, 7.0, wipe_in)
        film.wipe.scale = (radius, radius * 0.18, radius * 0.64)


def update_precision_lock(film: FilmScene, time: float) -> None:
    set_rig_visible(film.hero, False)
    set_rig_visible(film.final, True)
    rig = film.final
    rig.root.location = (-1.45, 0.10, 0.04)
    rig.root.rotation_euler = (0, 0, math.radians(mix(-12, -7, phase(time, 0.08, 1.24, ease_in_out))))
    rig.root.scale = (0.68, 0.68, 0.68)
    film.camera.location = (mix(0.52, 0.18, phase(time, 0, 1.35, ease_in_out)), mix(-9.90, -9.55, phase(time, 0, 1.35, ease_in_out)), mix(2.52, 2.55, phase(time, 0, 1.35, ease_in_out)))
    film.focus.location = (-0.05, 0.0, 1.50)
    look_at(film.camera, film.focus.location)

    base_in = phase(time, 0.06, 0.30, ease_out)
    for part in (rig.foot, rig.foot_rim):
        set_visible(part, base_in > 0.001)
        part.scale = (base_in, base_in, base_in)
    stem_in = phase(time, 0.20, 0.50, ease_out)
    set_visible(rig.stem, stem_in > 0.001)
    rig.stem.scale = (1, 1, max(0.001, stem_in))
    rig.stem.location.z = 0.06 + 0.59 * stem_in
    bowl_in = phase(time, 0.38, 0.78, drawer_ease)
    for part in (rig.shell, rig.rim):
        set_visible(part, bowl_in > 0.001)
        part.scale = (bowl_in, bowl_in, bowl_in)
    fill = phase(time, 0.72, 1.12, ease_out)
    bpy.context.view_layer.update()
    set_wine_fill_surface(rig, mix(WINE_BOTTOM_Z, WINE_REST_Z, fill))

    orbit: list[Vector] = []
    for index in range(180):
        progress = index / 179
        angle = mix(-1.25 * math.pi, 1.70 * math.pi, progress)
        radius = mix(2.36, 0.72, progress)
        orbit.append(
            Vector(
                (
                    -1.36 + math.cos(angle) * radius,
                    math.sin(angle) * radius * 0.52,
                    mix(0.18, 2.62, progress),
                )
            )
        )
    signal_radii = [mix(0.42, 0.82, index / 179) for index in range(180)]
    set_curve_points(film.route, orbit, signal_radii)
    set_curve_points(film.route_glow, orbit, signal_radii)
    set_curve_material(film.route, film.signal_material)
    set_curve_material(film.route_glow, film.signal_glow_material)
    film.route.data.bevel_depth = 0.012
    film.route_glow.data.bevel_depth = 0.020
    trace = phase(time, 0.04, 0.94, ease_in_out)
    film.route.data.bevel_factor_end = trace
    film.route_glow.data.bevel_factor_end = trace
    tracer = film.droplets[0]
    set_visible(tracer, 0.001 < trace < 0.999)
    if len(tracer.data.materials) == 0:
        tracer.data.materials.append(film.signal_material)
    elif tracer.data.materials[0] != film.signal_material:
        tracer.data.materials[0] = film.signal_material
    if 0.001 < trace < 0.999:
        tracer_position = trace * (len(orbit) - 1)
        tracer_floor = int(math.floor(tracer_position))
        tracer_ceil = min(len(orbit) - 1, tracer_floor + 1)
        tracer.location = orbit[tracer_floor].lerp(
            orbit[tracer_ceil],
            tracer_position - tracer_floor,
        )
        tracer.scale = (0.72, 0.72, 0.72)
    route_tail = phase(time, 1.02, 1.42, ease_out)
    film.route.data.bevel_factor_start = route_tail
    film.route_glow.data.bevel_factor_start = route_tail
    set_visible(film.route, route_tail < 0.995)
    set_visible(film.route_glow, route_tail < 0.995)

    word = phase(time, 1.02, 1.44, ease_out)
    set_visible(film.title, word > 0.001)
    set_text_alpha(film.title, word)
    title_scale = mix(0.97, 1.0, word)
    film.title.scale = (title_scale, title_scale, title_scale)
    film.title.location.z = mix(1.58, 1.64, word)
    tag = phase(time, 1.18, 1.56, ease_out)
    set_visible(film.tagline, tag > 0.001)
    set_text_alpha(film.tagline, tag)
    film.tagline.scale = (1.0, 1.0, 1.0)


def audit_liquid_causality(film: FilmScene, film_name: str) -> None:
    frames = (55, 65, 73, 82, 90) if film_name == "spill-route" else (40, 55, 70, 85, 95)
    for frame in frames:
        film.scene.frame_set(frame)
        update_frame(film.scene)
        bpy.context.view_layer.update()
        if film.hero.root.rotation_euler.y <= 0:
            raise RuntimeError(f"{film_name} frame {frame}: glass tips away from the +X pour")
        if film_name == "spill-route":
            foot_contact = film.hero.root.matrix_world @ Vector((0.72, 0.0, 0.0125))
            if abs(foot_contact.z - 0.045) > 0.002:
                raise RuntimeError(f"{film_name} frame {frame}: foot contact leaves the floor pivot")
        if film.liquid_sheet.hide_render:
            raise RuntimeError(f"{film_name} frame {frame}: expected pour is missing")
        if not film.hero.meniscus.hide_render:
            raise RuntimeError(f"{film_name} frame {frame}: duplicate meniscus is visible")
        if not film.hero.wine.hide_render:
            top_offset = (WINE_FILL_RINGS - 1) * WINE_FILL_SEGMENTS
            surface_heights = [
                (film.hero.wine.matrix_world @ film.hero.wine.data.vertices[top_offset + index].co).z
                for index in range(WINE_FILL_SEGMENTS)
            ]
            surface_range = max(surface_heights) - min(surface_heights)
            if surface_range > 0.004:
                raise RuntimeError(
                    f"{film_name} frame {frame}: wine free surface is not gravity-level "
                    f"(range {surface_range:.4f}, min {min(surface_heights):.4f}, max {max(surface_heights):.4f})"
                )

        centers: list[Vector] = []
        active_indices: list[int] = []
        vertices = film.liquid_sheet.data.vertices
        for index in range(len(vertices) // 2):
            left = vertices[index * 2].co
            right = vertices[index * 2 + 1].co
            centers.append((left + right) * 0.5)
            if (right - left).length > 0.0005:
                active_indices.append(index)
        if not active_indices:
            raise RuntimeError(f"{film_name} frame {frame}: liquid sheet is empty")
        if active_indices != list(range(active_indices[0], active_indices[-1] + 1)):
            raise RuntimeError(f"{film_name} frame {frame}: liquid sheet contains a gap")

        origin = film.hero.pour_origin.matrix_world.translation
        frame_time = (frame - 1) / FPS
        attached_emission = (
            film_name == "spill-route" and frame_time < 1.34
        ) or (
            film_name == "ribbon-flight" and frame_time < 0.92
        )
        if attached_emission:
            if active_indices[0] != 0 or (centers[0] - origin).length > 0.002:
                raise RuntimeError(f"{film_name} frame {frame}: attached sheet misses the leading rim")
        elif (centers[active_indices[0]] - origin).length < 0.002:
            raise RuntimeError(f"{film_name} frame {frame}: released liquid tail failed to advect")
        active_centers = centers[active_indices[0] : active_indices[-1] + 1]
        for previous, following in zip(active_centers, active_centers[1:]):
            if following.x + 0.004 < previous.x:
                raise RuntimeError(f"{film_name} frame {frame}: liquid reverses world-space direction")
        if active_centers[-1].x <= origin.x:
            raise RuntimeError(f"{film_name} frame {frame}: liquid leader travels behind the pouring rim")

        if film_name == "spill-route" and frame >= 73 and not film.route.hide_render:
            route_start = Vector(film.route.data.splines[0].points[0].co[:3])
            if (active_centers[-1] - route_start).length > 0.01:
                raise RuntimeError(f"{film_name} frame {frame}: airborne pour misses the grounded route")
    print(f"Motion causality audit passed for {film_name}.")


ACTIVE_FILM: FilmScene | None = None
FILM_NAME = "spill-route"


def update_frame(scene: bpy.types.Scene) -> None:
    if ACTIVE_FILM is None:
        return
    time = (scene.frame_current - 1 + scene.frame_subframe) / FPS
    reset_scene(ACTIVE_FILM)
    if FILM_NAME == "spill-route":
        update_spill_route(ACTIVE_FILM, time)
    elif FILM_NAME == "ribbon-flight":
        update_ribbon_flight(ACTIVE_FILM, time)
    else:
        update_precision_lock(ACTIVE_FILM, time)


def main() -> None:
    global ACTIVE_FILM, FILM_NAME
    args = parse_args()
    FILM_NAME = args.film
    ACTIVE_FILM = build_scene(args)
    durations = {"spill-route": 3.4, "ribbon-flight": 2.9, "precision-lock": 1.95}
    ACTIVE_FILM.scene.frame_start = args.frame_start or 1
    ACTIVE_FILM.scene.frame_end = args.frame_end or round(durations[args.film] * FPS)
    bpy.app.handlers.frame_change_pre.clear()
    bpy.app.handlers.frame_change_pre.append(update_frame)
    ACTIVE_FILM.scene.frame_set(args.frame_start or args.frame)
    update_frame(ACTIVE_FILM.scene)

    if args.audit:
        if args.film != "precision-lock":
            audit_liquid_causality(ACTIVE_FILM, args.film)
        return

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    ACTIVE_FILM.scene.render.filepath = str(output)
    if args.save_blend:
        blend_path = Path(args.save_blend).resolve()
        blend_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    if args.animation:
        bpy.ops.render.render(animation=True)
    else:
        bpy.ops.render.render(write_still=True)
    print(f"Rendered {args.film} frame {args.frame}: {output}")


if __name__ == "__main__":
    main()
