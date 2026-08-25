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
