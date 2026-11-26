import 'package:material_ui/material_ui.dart';

import '../models/badge_state.dart';

/// 2-column achievement grid; locked badges are dimmed, unlocked ones are
/// highlighted. Unlock state is computed by the repository, never stored here.
///
/// The grid is a `Wrap` of intrinsic-height tiles rather than a `GridView` with
/// a fixed `childAspectRatio`: badge names and requirements differ in length,
/// and an aspect ratio that fits "Hazard Hero" overflows on "Plastic Warrior"
/// at 390 px (caught by the widget tests).
class BadgeGrid extends StatelessWidget {
  const BadgeGrid({super.key, required this.badges});

  final List<BadgeState> badges;

  @override
  Widget build(BuildContext context) {
    if (badges.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Text('Set a profile to load your badges.'),
        ),
      );
    }

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        const double spacing = 10;
        final double tileWidth = (constraints.maxWidth - spacing) / 2;
        return Wrap(
          spacing: spacing,
          runSpacing: spacing,
          children: <Widget>[
            for (final BadgeState badge in badges)
              SizedBox(
                width: tileWidth,
                child: _BadgeTile(badge: badge),
              ),
          ],
        );
      },
    );
  }
}

class _BadgeTile extends StatelessWidget {
  const _BadgeTile({required this.badge});

  final BadgeState badge;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return AnimatedOpacity(
      duration: const Duration(milliseconds: 220),
      opacity: badge.unlocked ? 1 : 0.45,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
        decoration: BoxDecoration(
          color: badge.unlocked ? scheme.primaryContainer : scheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: badge.unlocked ? scheme.primary : scheme.outlineVariant,
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(badge.emoji, style: const TextStyle(fontSize: 22)),
            const SizedBox(height: 6),
            Text(
              badge.name,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              badge.requirement,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall,
            ),
            const SizedBox(height: 6),
            Text(
              badge.unlocked ? 'Unlocked' : 'Locked',
              key: ValueKey<String>('badge-state-${badge.id}'),
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: badge.unlocked ? scheme.primary : scheme.onSurfaceVariant,
                    letterSpacing: 0.6,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}
