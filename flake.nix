{
  description = "an application to build interactive slideshwows for terminal pcs";
  inputs.flake-utils.url = "github:numtide/flake-utils";
  outputs = { self, nixpkgs, flake-utils }:
    let
       name = "slideshower";
       systems = [ "x86_64-linux" ];
       overlay = final: prev: {
         ${name}.defaultPackage = final.callPackage ./package.nix {};
       };

       simpleFlake = flake-utils.lib.simpleFlake {
         inherit name systems overlay self nixpkgs;
       };
     in simpleFlake // {
       inherit overlay;
     };

}
