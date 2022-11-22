import 'package:flutter/material.dart';
import '../feature_flags_toggly.dart';

enum FeatureRequirement { any, all }

class Feature extends StatefulWidget {
  const Feature({
    Key? key,
    required this.child,
    required this.featureKeys,
    this.requirement = FeatureRequirement.all,
    this.negate = false,
  }) : super(key: key);

  final List<String> featureKeys;
  final Widget child;
  final FeatureRequirement requirement;
  final bool negate;

  @override
  FeatureState createState() => FeatureState();
}

class FeatureState extends State<Feature> {
  FeatureState();

  bool? previousResult;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: Toggly.evaluateFeatureGate(
        widget.featureKeys,
        requirement: widget.requirement,
        negate: widget.negate,
      ),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.done) {
          previousResult = snapshot.data;
          return snapshot.data == true ? widget.child : const SizedBox();
        }

        return previousResult == true ? widget.child : const SizedBox();
      },
    );
  }
}
