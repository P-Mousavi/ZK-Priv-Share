// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity ^0.8.20;

contract Groth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 12150632891003841897359558905219059101116015202213241827867077813817198668578;
    uint256 constant alphay  = 6688107424454187488887560557454521367144871258076149184436320985841223594417;
    uint256 constant betax1  = 19905836734893012196016362191157081433645073731331924138514419167096002266936;
    uint256 constant betax2  = 4828078352469579028328929800392412611977327174697943482688142866892285171454;
    uint256 constant betay1  = 15195077133541464359232924453097434184146473947598979741234434045066016585363;
    uint256 constant betay2  = 19080385647126644712371917587536460755807428323321750236846537806934424580048;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 13118300074236673409445419228940094882907242134668439459797736836870718763929;
    uint256 constant deltax2 = 20543802750740170805315786431897756065986227041547115306488778167078619051393;
    uint256 constant deltay1 = 4244923472948843261087656258245471982262637912228108724928814349992573809984;
    uint256 constant deltay2 = 10748553486203500080253802952063658805494005485159730395843513584049037959325;

    
    uint256 constant IC0x = 5093543947139227489196403855323286200079717764483268856693934910830452081898;
    uint256 constant IC0y = 7635689484842045537961164967026293607214201859384489299791503077881200555404;
    
    uint256 constant IC1x = 15130830748468220064751576496789035518165606902131554628194933782824035246683;
    uint256 constant IC1y = 13083506859700738616781028633443502445742655522044088017701669533998280764841;
    
    uint256 constant IC2x = 2630952444243926040982282879711226143444666520755743271897977655520476030168;
    uint256 constant IC2y = 13272619024300213234898981199569527824428926800501405850272359354080278104985;
    
    uint256 constant IC3x = 159082781920484589197656756380374700269110205043204416435094579459923321116;
    uint256 constant IC3y = 20024486265213497247063305930692610762132187185643899984466274048646541311500;
    
    uint256 constant IC4x = 7755517814147203196231167856949795138280001662477400147637292377011869445191;
    uint256 constant IC4y = 1281787384631688122182066873941917841189059622834888204812530591315622872821;
    
    uint256 constant IC5x = 3372735933080245391129674014921114087792787845914227085361480828852695384896;
    uint256 constant IC5y = 12555858612126597292356612061058245012653594071143023996241115611984048916206;
    
    uint256 constant IC6x = 888553727286902543734421543140306413838534618833359917985446127673270477942;
    uint256 constant IC6y = 1996406151638715684415329003273600808541908685801334593250914448228174679487;
    
    uint256 constant IC7x = 11715261835022802424468107595346971587022443286402938078002547746883683987093;
    uint256 constant IC7y = 15029823949073280178442504444129029162490695209450180262360381663215021179627;
    
    uint256 constant IC8x = 9973467633492334452987791578606704853390855230565789666288758282944111648458;
    uint256 constant IC8y = 1397808184671856516875275653070601491947516162314322309951067428389915923230;
    
    uint256 constant IC9x = 9975037726066931274979341885541395949436003917705386648194003271169815883173;
    uint256 constant IC9y = 16264267007141445903047099687162812221846097832790172657847580835778682096348;
    
    uint256 constant IC10x = 409711112072838422235755720907659967637943699982770853376743934584365404701;
    uint256 constant IC10y = 6883746395149572493175679851986445447634959821770167703582629459444195821891;
    
    uint256 constant IC11x = 15357524383583804732578131944837411358940606667978241825673495876324040939640;
    uint256 constant IC11y = 5010872064705388976861264076384349214829940887334298373292412372282216004219;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[11] calldata _pubSignals) public view virtual returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
