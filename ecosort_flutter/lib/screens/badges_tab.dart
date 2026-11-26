import 'package:material_ui/material_ui.dart';

import '../services/ecosort_controller.dart';
import '../widgets/badge_grid.dart';
import '../widgets/challenge_list.dart';

/// Tab 2 — Badges & 7-Day Challenge.
class BadgesTab extends StatelessWidget {
  const BadgesTab({super.key, required this.controller});

  final EcoSortController controller;

  @override
  Widget build(BuildContext context) {
    final snapshot = controller.snapshot;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: <Widget>[
        Text(
          'Achievement Badges',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        Text(
          'Badges unlock from your disposal history — no separate claim.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 12),
        BadgeGrid(badges: snapshot?.badges ?? const []),
        const SizedBox(height: 24),
        Text(
          '7-Day Zero-Waste Challenge',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        Text(
          'Claim 15 Eco Points for each day you actually complete.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 12),
        ChallengeList(
          challenges: snapshot?.challenges ?? const [],
          busy: controller.busy,
          onClaim: (int day) async {
            await controller.claimDay(day);
            if (!context.mounted) {
              return;
            }
            final String message =
                controller.notice ?? controller.error ?? 'Nothing to claim.';
            ScaffoldMessenger.of(context)
              ..hideCurrentSnackBar()
              ..showSnackBar(SnackBar(content: Text(message)));
            controller.clearNotice();
          },
        ),
      ],
    );
  }
}
