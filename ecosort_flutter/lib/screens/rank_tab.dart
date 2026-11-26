import 'package:material_ui/material_ui.dart';

import '../services/ecosort_controller.dart';
import '../widgets/leaderboard_cards.dart';

/// Tab 3 — Leaderboards: everyone first, then community/group standings.
class RankTab extends StatelessWidget {
  const RankTab({super.key, required this.controller});

  final EcoSortController controller;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: controller.refreshLeaderboards,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  'Top Eco Contributors',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              IconButton(
                tooltip: 'Refresh',
                onPressed: controller.busy ? null : controller.refreshLeaderboards,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Everyone, everywhere — ranked by Eco Points.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          TopUsersCard(entries: controller.topUsers),
          const SizedBox(height: 24),
          Text(
            'Community & Group Standings',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            'Households, streets, societies, offices — any group can compete.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          GroupStandingsCard(standings: controller.groupStandings),
        ],
      ),
    );
  }
}
