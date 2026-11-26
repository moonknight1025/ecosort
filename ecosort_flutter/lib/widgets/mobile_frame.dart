import 'package:material_ui/material_ui.dart';

/// On screens wider than [breakpoint] the app renders inside a centred 430 px
/// phone frame; narrower screens get the app full-bleed. This is a presentation
/// shell only — nothing below it knows the difference.
class MobileFrame extends StatelessWidget {
  const MobileFrame({super.key, required this.child});

  final Widget child;

  static const double breakpoint = 520;
  static const double phoneWidth = 430;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        if (constraints.maxWidth <= breakpoint) {
          return child;
        }
        return ColoredBox(
          color: const Color(0xFFE6ECE6),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(30),
                  boxShadow: const <BoxShadow>[
                    BoxShadow(
                      color: Color(0x1F000000),
                      blurRadius: 28,
                      offset: Offset(0, 14),
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(30),
                  child: SizedBox(
                    width: phoneWidth,
                    height: (constraints.maxHeight - 40).clamp(360.0, 2000.0),
                    child: child,
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
