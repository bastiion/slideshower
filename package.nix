{ mkYarnPackage }:
mkYarnPackage {
  src = ./.;

  doCheck = false;
  distPhase  = "true";

  installPhase = ''
     mkdir $out
    mv deps/$pname/index.* $out
    mv deps/$pname/public $out
    mv deps/$pname/package.json $out
    mv node_modules $out
  '';
}
