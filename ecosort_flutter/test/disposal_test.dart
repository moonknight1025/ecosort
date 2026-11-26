import 'package:ecosort_flutter/data/classifier.dart';
import 'package:ecosort_flutter/models/waste_category.dart';
import 'package:ecosort_flutter/services/key_value_store.dart';
import 'package:ecosort_flutter/services/local_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const WasteClassifier classifier = WasteClassifier();
  late InMemoryKeyValueStore store;
  late LocalRepository repository;

  setUp(() {
    store = InMemoryKeyValueStore();
    repository = LocalRepository(store: store);
  });

  test('a disposal awards the catalog points and increments the right bin',
      () async {
    final before =
        await repository.loadProfile(username: 'You', campus: 'Main Campus');
    expect(before.user.ecoPoints, 0);
    expect(before.binCount(WasteCategory.hazardous), 0);

    final item = classifier.classify(presetKeyword: 'battery');
    final after = await repository.dispose(username: 'You', item: item);

    expect(after.user.ecoPoints, 25);
    expect(after.binCount(WasteCategory.hazardous), 1);
    expect(after.binCount(WasteCategory.recyclable), 0);
    expect(after.totalDisposals, 1);
  });

  test('First Step and Hazard Hero unlock on the first hazardous disposal',
      () async {
    final item = classifier.classify(presetKeyword: 'battery');
    final after = await repository.dispose(username: 'You', item: item);

    expect(
      after.badges.firstWhere((badge) => badge.id == 'first_step').unlocked,
      isTrue,
    );
    expect(
      after.badges.firstWhere((badge) => badge.id == 'hazard_hero').unlocked,
      isTrue,
    );
    expect(
      after.badges.firstWhere((badge) => badge.id == 'plastic_warrior').unlocked,
      isFalse,
    );
    expect(
      after.badges.firstWhere((badge) => badge.id == 'green_champion').unlocked,
      isFalse,
    );
  });

  test('points and bin counts survive a new repository over the same store',
      () async {
    final item = classifier.classify(presetKeyword: 'bottle');
    await repository.dispose(username: 'You', item: item);

    final LocalRepository reloaded = LocalRepository(store: store);
    final snapshot =
        await reloaded.loadProfile(username: 'You', campus: 'Main Campus');

    expect(snapshot.user.ecoPoints, 15);
    expect(snapshot.binCount(WasteCategory.recyclable), 1);
  });

  test('Plastic Warrior unlocks after three recyclable or dry disposals',
      () async {
    final item = classifier.classify(presetKeyword: 'wrapper');
    await repository.dispose(username: 'You', item: item);
    await repository.dispose(username: 'You', item: item);
    final after = await repository.dispose(username: 'You', item: item);

    expect(
      after.badges.firstWhere((badge) => badge.id == 'plastic_warrior').unlocked,
      isTrue,
    );
    expect(after.plasticDisposals, 3);
    expect(after.user.ecoPoints, 30);
  });

  test('Green Champion needs 100 points', () async {
    final item = classifier.classify(presetKeyword: 'battery');
    // 4 hazardous disposals = 100 points.
    for (int i = 0; i < 4; i++) {
      await repository.dispose(username: 'You', item: item);
    }
    final snapshot =
        await repository.loadProfile(username: 'You', campus: 'Main Campus');
    expect(snapshot.user.ecoPoints, 100);
    expect(
      snapshot.badges
          .firstWhere((badge) => badge.id == 'green_champion')
          .unlocked,
      isTrue,
    );
  });

  test('disposing never moves the user to another campus', () async {
    await repository.loadProfile(username: 'You', campus: 'Science Block');
    final item = classifier.classify(presetKeyword: 'box');
    final after = await repository.dispose(username: 'You', item: item);

    expect(after.user.campus, 'Science Block');
  });

  test('the seeded demo users populate both leaderboards', () async {
    final standings = await repository.campusStandings();
    expect(standings.length, 4);
    expect(standings.first.campus, 'North Campus');
    expect(standings.first.totalPoints, 145);
    expect(standings.first.members, 1);

    final users = await repository.topUsers();
    expect(users.length, 4);
    expect(users.first.username, 'Aarav');
    expect(users.first.points, 145);
    // Sorted descending.
    for (int i = 1; i < users.length; i++) {
      expect(users[i - 1].points >= users[i].points, isTrue);
    }
  });
}
