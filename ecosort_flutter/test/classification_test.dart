import 'package:ecosort_flutter/data/classifier.dart';
import 'package:ecosort_flutter/models/waste_category.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const WasteClassifier classifier = WasteClassifier();

  group('deterministic classification', () {
    test('preset battery is Hazardous Waste at 25 points', () {
      final result = classifier.classify(presetKeyword: 'battery');
      expect(result.category, WasteCategory.hazardous);
      expect(result.points, 25);
      expect(result.matchedKeyword, 'battery');
      expect(result.isFallback, isFalse);
    });

    test('plastic_bottle_01.jpg is Recyclable Waste at 15 points', () {
      final result = classifier.classify(imageName: 'plastic_bottle_01.jpg');
      expect(result.category, WasteCategory.recyclable);
      expect(result.points, 15);
      expect(result.isFallback, isFalse);
    });

    test('unrecognised file falls back to Dry Waste at 10 points', () {
      final result = classifier.classify(imageName: 'mystery_object.png');
      expect(result.category, WasteCategory.dry);
      expect(result.points, 10);
      expect(result.isFallback, isTrue);
      expect(result.matchedKeyword, isNull);
    });

    test('empty input falls back instead of throwing', () {
      final result = classifier.classify();
      expect(result.category, WasteCategory.dry);
      expect(result.isFallback, isTrue);
    });

    test('the 3-character "med" keyword never fires mid-word', () {
      for (final String name in <String>[
        'media_player.png',
        'immediate_photo.jpg',
      ]) {
        final result = classifier.classify(imageName: name);
        expect(result.category, isNot(WasteCategory.hazardous),
            reason: '$name must not be treated as medicine');
        expect(result.isFallback, isTrue, reason: '$name should not match');
      }
    });

    test('aliases and case-insensitivity resolve to the seeded keyword', () {
      expect(
        classifier.classify(imageName: 'MEDICINE.JPG').category,
        WasteCategory.hazardous,
      );
      expect(
        classifier.classify(imageName: 'Laptop.png').category,
        WasteCategory.ewaste,
      );
    });

    test('multi-word filenames and non-ASCII names stay safe', () {
      expect(
        classifier.classify(imageName: 'banana_peel_01.jpg').category,
        WasteCategory.wet,
      );
      // A Tamil filename carries no latin keyword, so it must degrade to the
      // documented fallback rather than crash.
      final tamil = classifier.classify(imageName: 'குப்பை.jpg');
      expect(tamil.category, WasteCategory.dry);
      expect(tamil.isFallback, isTrue);
    });

    test('a substring-only keyword needs 5 characters', () {
      // "paper" (5) may match inside "newspaper"; "box" (3) may only match a
      // whole token.
      expect(
        classifier.classify(imageName: 'newspaper.jpg').category,
        WasteCategory.recyclable,
      );
      expect(
        classifier.classify(imageName: 'soapbox.png').category,
        WasteCategory.dry,
        reason: '"box" must not match inside "soapbox"',
      );
    });
  });
}
