import 'package:ecosort_flutter/main.dart';
import 'package:ecosort_flutter/services/ecosort_controller.dart';
import 'package:ecosort_flutter/services/key_value_store.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';

/// Widget tests run in a phone-shaped, tall viewport. The default 800x600 test
/// surface puts most of a tab inside a `ListView` that is never built, so
/// finders would fail for reasons that have nothing to do with the behaviour
/// under test.
void usePhoneViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 1800);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  // An in-memory store keeps the widget tests off shared_preferences (which
  // would need a platform channel mock) and gives every test a clean slate.
  EcoSortController buildController() =>
      EcoSortController(store: InMemoryKeyValueStore());

  testWidgets('opens on the Scan & Bin tab', (WidgetTester tester) async {
    usePhoneViewport(tester);
    await tester.pumpWidget(EcoSortApp(controller: buildController()));
    await tester.pumpAndSettle();

    expect(find.text('Scan & Bin'), findsOneWidget);
    expect(find.text('Virtual Recycling Bins'), findsOneWidget);
    // No result card until something is scanned.
    expect(find.text('Toss into Virtual Bin'), findsNothing);
  });

  testWidgets('navigation swaps the three tabs', (WidgetTester tester) async {
    usePhoneViewport(tester);
    await tester.pumpWidget(EcoSortApp(controller: buildController()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Badges'));
    await tester.pumpAndSettle();
    expect(find.text('Achievement Badges'), findsOneWidget);
    expect(find.text('7-Day Zero-Waste Challenge'), findsOneWidget);
    expect(find.text('Scan & Bin'), findsNothing);

    await tester.tap(find.text('Rank'));
    await tester.pumpAndSettle();
    expect(find.text('Campus Cleanliness Battle'), findsOneWidget);
    expect(find.text('Top Eco Warriors'), findsOneWidget);
    expect(find.text('Achievement Badges'), findsNothing);

    await tester.tap(find.text('Scan'));
    await tester.pumpAndSettle();
    expect(find.text('Scan & Bin'), findsOneWidget);
    expect(find.text('Campus Cleanliness Battle'), findsNothing);
  });

  testWidgets('the Eco Points pill renders the current score',
      (WidgetTester tester) async {
    usePhoneViewport(tester);
    await tester.pumpWidget(EcoSortApp(controller: buildController()));
    await tester.pumpAndSettle();

    // A brand-new profile starts at zero.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey<String>('eco-points')),
        matching: find.text('🌟 0 pts'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('tapping a sample chip produces a result card and bins',
      (WidgetTester tester) async {
    usePhoneViewport(tester);
    await tester.pumpWidget(EcoSortApp(controller: buildController()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Used Battery'));
    await tester.pumpAndSettle();

    expect(find.text('Used Alkaline / Li-ion Battery'), findsOneWidget);
    expect(find.text('+25 pts'), findsOneWidget);
    expect(find.text('Hazardous Waste'), findsWidgets);
  });

  testWidgets('tossing the item credits points and increments the bin',
      (WidgetTester tester) async {
    usePhoneViewport(tester);
    await tester.pumpWidget(EcoSortApp(controller: buildController()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Plastic Bottle'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Toss into Virtual Bin'));
    await tester.pumpAndSettle();

    expect(
      find.descendant(
        of: find.byKey(const ValueKey<String>('eco-points')),
        matching: find.text('🌟 15 pts'),
      ),
      findsOneWidget,
    );
    final Finder recyclableCount =
        find.byKey(const ValueKey<String>('bin-count-recyclable'));
    expect(recyclableCount, findsOneWidget);
    expect(tester.widget<Text>(recyclableCount).data, '1');
  });

  testWidgets('claiming a challenge day adds 15 points once',
      (WidgetTester tester) async {
    usePhoneViewport(tester);
    await tester.pumpWidget(EcoSortApp(controller: buildController()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Badges'));
    await tester.pumpAndSettle();

    final Finder firstClaim = find.text('Claim +15').first;
    await tester.tap(firstClaim);
    await tester.pumpAndSettle();

    expect(
      find.descendant(
        of: find.byKey(const ValueKey<String>('eco-points')),
        matching: find.text('🌟 15 pts'),
      ),
      findsOneWidget,
    );
    // The button is now disabled and relabelled.
    expect(find.text('Claimed'), findsWidgets);
  });
}
