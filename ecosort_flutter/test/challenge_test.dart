import 'package:ecosort_flutter/data/challenge_catalog.dart';
import 'package:ecosort_flutter/services/key_value_store.dart';
import 'package:ecosort_flutter/services/local_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late InMemoryKeyValueStore store;
  late LocalRepository repository;

  setUp(() {
    store = InMemoryKeyValueStore();
    repository = LocalRepository(store: store);
  });

  test('seven challenge days are created uncompleted for a new user', () async {
    final snapshot =
        await repository.loadProfile(username: 'You', groupName: 'General Community', city: 'Local Area');
    expect(snapshot.challenges.length, 7);
    expect(snapshot.challenges.every((day) => !day.completed), isTrue);
    expect(snapshot.challenges.first.dayNumber, 1);
    expect(snapshot.challenges.first.task, challengeTasks[1]);
  });

  test('claiming day 1 awards +15 once', () async {
    await repository.loadProfile(username: 'You', groupName: 'General Community', city: 'Local Area');
    final first = await repository.claimChallenge(username: 'You', day: 1);

    expect(first.user.ecoPoints, 15);
    expect(first.challenges.first.completed, isTrue);
    expect(first.claimedDays, 1);
  });

  test('a duplicate claim awards nothing and keeps the day completed', () async {
    await repository.loadProfile(username: 'You', groupName: 'General Community', city: 'Local Area');
    final first = await repository.claimChallenge(username: 'You', day: 1);
    final second = await repository.claimChallenge(username: 'You', day: 1);
    final third = await repository.claimChallenge(username: 'You', day: 1);

    expect(first.user.ecoPoints, 15);
    expect(second.user.ecoPoints, 15, reason: 'no double credit');
    expect(third.user.ecoPoints, 15);
    expect(second.challenges.first.completed, isTrue);
  });

  test('the duplicate-claim guard survives a fresh repository', () async {
    await repository.loadProfile(username: 'You', groupName: 'General Community', city: 'Local Area');
    await repository.claimChallenge(username: 'You', day: 2);

    final LocalRepository reloaded = LocalRepository(store: store);
    final afterReclaim = await reloaded.claimChallenge(username: 'You', day: 2);

    expect(afterReclaim.user.ecoPoints, challengeReward);
    expect(
      afterReclaim.challenges.firstWhere((day) => day.dayNumber == 2).completed,
      isTrue,
    );
  });

  test('all seven days can be claimed, totalling 7 x 15 points', () async {
    await repository.loadProfile(username: 'You', groupName: 'General Community', city: 'Local Area');
    for (int day = 1; day <= 7; day++) {
      await repository.claimChallenge(username: 'You', day: day);
    }
    final snapshot =
        await repository.loadProfile(username: 'You', groupName: 'General Community', city: 'Local Area');

    expect(snapshot.claimedDays, 7);
    expect(snapshot.user.ecoPoints, challengeReward * 7);
  });
}
