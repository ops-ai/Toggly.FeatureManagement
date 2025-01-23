import 'package:flutter/material.dart';
import '../feature_flags_toggly.dart';

/// Feature requirement types allowing "ANY" or "ALL" operations when evaluating
/// feature gates.
enum FeatureRequirement { any, all }

/// Creates a feature Widget that can be enabled, disabled or partially enabled,
/// described by the provided [featureKeys] and following the [requirement] and
/// [negate] parameters.
class Feature extends StatefulWidget {
  const Feature({
    Key? key,
    this.child,
    this.children,
    required this.featureKeys,
    this.requirement = FeatureRequirement.all,
    this.negate = false,
  })  : assert(child != null || children != null,
            'Either child or children must be provided'),
        assert(child == null || children == null,
            'Cannot provide both child and children'),
        super(key: key);

  final Widget? child;
  final List<Widget>? children;
  final List<String> featureKeys;
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
          if (snapshot.data != true) return const SizedBox();

          return widget.child ?? Column(children: widget.children!);
        }

        if (previousResult != true) return const SizedBox();
        return widget.child ?? Column(children: widget.children!);
      },
    );
  }
}
