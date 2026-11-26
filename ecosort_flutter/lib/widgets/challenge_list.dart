import 'package:material_ui/material_ui.dart';

import '../data/challenge_catalog.dart';
import '../models/challenge_day.dart';

/// The 7-day checklist. A completed day is struck through and its button is
/// disabled, which is the client half of the duplicate-claim guard — the
/// repository enforces the other half.
class ChallengeList extends StatelessWidget {
  const ChallengeList({
    super.key,
    required this.challenges,
    required this.onClaim,
    this.busy = false,
  });

  final List<ChallengeDay> challenges;
  final void Function(int day) onClaim;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    if (challenges.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Text('Set a profile to load the 7-day challenge.'),
        ),
      );
    }

    final ColorScheme scheme = Theme.of(context).colorScheme;
    return Column(
      children: <Widget>[
        for (final ChallengeDay day in challenges)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: day.completed ? scheme.primaryContainer : scheme.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: day.completed ? scheme.primary : scheme.outlineVariant,
                ),
              ),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'Day ${day.dayNumber}',
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(
                                fontWeight: FontWeight.w800,
                                color: scheme.primary,
                                letterSpacing: 0.6,
                              ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          day.task,
                          style: TextStyle(
                            decoration:
                                day.completed ? TextDecoration.lineThrough : null,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton.tonal(
                    onPressed: (day.completed || busy)
                        ? null
                        : () => onClaim(day.dayNumber),
                    child: Text(
                      day.completed ? 'Claimed' : 'Claim +$challengeReward',
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
