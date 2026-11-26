import 'package:material_ui/material_ui.dart';

import '../models/leaderboard.dart';

/// Community & Group Standings: points and member counts per group.
class GroupStandingsCard extends StatelessWidget {
  const GroupStandingsCard({super.key, required this.standings});

  final List<GroupStanding> standings;

  @override
  Widget build(BuildContext context) {
    if (standings.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Text('Group standings load once a profile is set.'),
        ),
      );
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
        child: Column(
          children: <Widget>[
            for (int i = 0; i < standings.length; i++)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: <Widget>[
                    _Position(position: i + 1),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            standings[i].groupName,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          Text(
                            '${standings[i].members} member'
                            '${standings[i].members == 1 ? '' : 's'}',
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        ],
                      ),
                    ),
                    Text(
                      '${standings[i].totalPoints} pts',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Top Eco Contributors: individual rankings, already sorted by the repository.
class TopUsersCard extends StatelessWidget {
  const TopUsersCard({super.key, required this.entries});

  final List<LeaderboardEntry> entries;

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Text('Individual rankings load once a profile is set.'),
        ),
      );
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
        child: Column(
          children: <Widget>[
            for (int i = 0; i < entries.length; i++)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: <Widget>[
                    _Position(position: i + 1),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            entries[i].username,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          Text(
                            entries[i].subtitle,
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        ],
                      ),
                    ),
                    Text(
                      '${entries[i].points} pts',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Position extends StatelessWidget {
  const _Position({required this.position});

  final int position;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return CircleAvatar(
      radius: 13,
      backgroundColor: scheme.primaryContainer,
      child: Text(
        '$position',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          color: scheme.onPrimaryContainer,
        ),
      ),
    );
  }
}
