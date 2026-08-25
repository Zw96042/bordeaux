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
